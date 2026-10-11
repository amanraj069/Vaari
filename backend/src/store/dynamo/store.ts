/**
 * VaariStore on DynamoDB, one table per entity (see tables.ts and docs/DECISIONS.md).
 * Every hot-path read is a GetItem or a single-partition Query on the CHC; there are no scans
 * except listChcs (a handful of rows). Records keep their app field names; the table key
 * attributes (chcId, fieldId, promiseKey, …) are added on write and stripped on read.
 */
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import {
  StoreConflictError,
  type ChcRecord,
  type FarmerRecord,
  type FieldPlanUpdate,
  type FieldRecord,
  type FireCheckRecord,
  type DeliveryStatus,
  type FarmerAccountRecord,
  type OtpChallengeRecord,
  type LoginTokenRecord,
  type MachineRecord,
  type OutboundNoticeRecord,
  type WhatsAppDraftRecord,
  type PlanChanges,
  type PlanRecord,
  type PromiseRecord,
  type PublishWrites,
  type UserRecord,
  type VaariStore,
  type WorkLogRecord,
} from "../types";
import { logKey, planKey, promiseKey, tableName, TABLES, type TableKey } from "./tables";

type Item = Record<string, unknown>;

/** Index key attributes must be strings or absent; a NULL there is rejected by DynamoDB. */
function withoutNullKeys(item: Item, keys: string[]): Item {
  const result = { ...item };
  for (const key of keys) if (result[key] === null) delete result[key];
  return result;
}

function omit(item: Item, keys: string[]): Item {
  const result = { ...item };
  for (const key of keys) delete result[key];
  return result;
}

const BATCH_SIZE = 25;
const epochSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const MAX_BATCH_RETRIES = 8;

export class DynamoStore implements VaariStore {
  constructor(
    private readonly documents: DynamoDBDocumentClient,
    private readonly prefix: string,
  ) {}

  private table(table: TableKey) {
    return tableName(this.prefix, table);
  }

  private async queryAll(input: QueryCommandInput): Promise<Item[]> {
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.documents.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
      items.push(...((page.Items as Item[] | undefined) ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return items;
  }

  private queryPartition(table: TableKey, partitionValue: string, extra: Partial<QueryCommandInput> = {}) {
    const partitionKey = TABLES[table].partitionKey.name;
    return this.queryAll({
      TableName: this.table(table),
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": partitionKey, ...(extra.ExpressionAttributeNames ?? {}) },
      ExpressionAttributeValues: { ":pk": partitionValue, ...(extra.ExpressionAttributeValues ?? {}) },
      ...omit(extra as Item, ["ExpressionAttributeNames", "ExpressionAttributeValues"]),
    });
  }

  private async put(table: TableKey, item: Item) {
    await this.documents.send(new PutCommand({ TableName: this.table(table), Item: item }));
  }

  private async get(table: TableKey, key: Item): Promise<Item | null> {
    const result = await this.documents.send(new GetCommand({ TableName: this.table(table), Key: key }));
    return (result.Item as Item | undefined) ?? null;
  }

  // --- CHCs --------------------------------------------------------------------------------

  async listChcs() {
    const items: Item[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await this.documents.send(new ScanCommand({ TableName: this.table("chcs"), ExclusiveStartKey: startKey }));
      items.push(...((page.Items as Item[] | undefined) ?? []));
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    // The season clock shares the table under a key no centre can have (see SEASON_CLOCK_KEY).
    return items.filter((item) => item.chcId !== SEASON_CLOCK_KEY).map(fromChcItem).sort((left, right) => (left.id < right.id ? -1 : 1));
  }
  async getSeasonDayOffset() {
    const item = await this.get("chcs", { chcId: SEASON_CLOCK_KEY });
    return typeof item?.offset === "number" ? item.offset : 0;
  }
  async setSeasonDayOffset(offset: number) {
    await this.put("chcs", { chcId: SEASON_CLOCK_KEY, offset });
  }
  async getChc(chcId: string) {
    const item = await this.get("chcs", { chcId });
    return item ? fromChcItem(item) : null;
  }
  async putChc(chc: ChcRecord) {
    await this.put("chcs", { ...omit(chc, ["id"]), chcId: chc.id });
  }

  // --- Machines ----------------------------------------------------------------------------

  async listMachines(chcId: string) {
    return (await this.queryPartition("machines", chcId)).map(fromMachineItem);
  }
  async putMachine(machine: MachineRecord) {
    await this.put("machines", { ...omit(machine, ["id"]), machineId: machine.id });
  }
  async deleteMachine(chcId: string, machineId: string) {
    await this.documents.send(new DeleteCommand({ TableName: this.table("machines"), Key: { chcId, machineId } }));
  }

  // --- Fields ------------------------------------------------------------------------------

  async listFields(chcId: string) {
    return (await this.queryPartition("fields", chcId)).map(fromFieldItem);
  }
  async getField(chcId: string, fieldId: string) {
    const item = await this.get("fields", { chcId, fieldId });
    return item ? fromFieldItem(item) : null;
  }
  async putField(field: FieldRecord) {
    await this.put("fields", withoutNullKeys({ ...omit(field, ["id"]), fieldId: field.id }, ["bookedBy", "farmerPhone"]));
  }
  async deleteField(chcId: string, fieldId: string) {
    await this.documents.send(new DeleteCommand({ TableName: this.table("fields"), Key: { chcId, fieldId } }));
  }
  async setFieldPlan(chcId: string, update: FieldPlanUpdate) {
    try {
      await this.documents.send(
        new UpdateCommand({
          TableName: this.table("fields"),
          Key: { chcId, fieldId: update.fieldId },
          // A field removed or sown since the plan was approved is left alone.
          ConditionExpression: "attribute_exists(fieldId) AND #state <> :done",
          UpdateExpression: "SET plannedDay = :day, plannedMachineId = :machine, #state = :state REMOVE soonerRequestedAt",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":done": "done", ":day": update.plannedDay, ":machine": update.plannedMachineId, ":state": update.state },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return;
      throw error;
    }
  }
  async listFieldsByFarmer(chcId: string, farmerId: string) {
    // A farmer has a handful of fields inside one CHC partition: query the partition, filter by farmer.
    const items = await this.queryPartition("fields", chcId, {
      FilterExpression: "#farmer = :farmer",
      ExpressionAttributeNames: { "#farmer": "farmerId" },
      ExpressionAttributeValues: { ":farmer": farmerId },
    });
    return items.map(fromFieldItem);
  }
  async listFieldsBookedBy(userId: string) {
    const items = await this.queryAll({
      TableName: this.table("fields"),
      IndexName: "booked-by-index",
      KeyConditionExpression: "bookedBy = :booker",
      ExpressionAttributeValues: { ":booker": userId },
    });
    return items.map(fromFieldItem);
  }
  async listFieldsByPhone(phone: string) {
    const items = await this.queryAll({
      TableName: this.table("fields"),
      IndexName: "phone-index",
      KeyConditionExpression: "farmerPhone = :phone",
      ExpressionAttributeValues: { ":phone": phone },
    });
    return items.map(fromFieldItem);
  }
  async bumpLinkVersion(chcId: string, fieldId: string) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("fields"),
          Key: { chcId, fieldId },
          ConditionExpression: "attribute_exists(fieldId)",
          // Fields written before link versions existed count as version 1.
          UpdateExpression: "SET linkVersion = if_not_exists(linkVersion, :one) + :one",
          ExpressionAttributeValues: { ":one": 1 },
          ReturnValues: "ALL_NEW",
        }),
      );
      return fromFieldItem(result.Attributes as Item);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  // --- Promises ----------------------------------------------------------------------------

  async listPromises(chcId: string) {
    return (await this.queryPartition("promises", chcId)).map(fromPromiseItem);
  }
  async promiseHistory(chcId: string, fieldId: string) {
    const items = await this.queryAll({
      TableName: this.table("promises"),
      KeyConditionExpression: "chcId = :chc AND begins_with(promiseKey, :prefix)",
      ExpressionAttributeValues: { ":chc": chcId, ":prefix": `${fieldId}#` },
    });
    return items.map(fromPromiseItem);
  }
  async putPromise(record: PromiseRecord) {
    await this.put("promises", { ...record, promiseKey: promiseKey(record.fieldId, record.version) });
  }

  // --- Plans -------------------------------------------------------------------------------

  async latestPlan(chcId: string) {
    const page = await this.documents.send(
      new QueryCommand({
        TableName: this.table("plans"),
        KeyConditionExpression: "chcId = :chc",
        ExpressionAttributeValues: { ":chc": chcId },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    const item = (page.Items as Item[] | undefined)?.[0];
    return item ? fromPlanItem(item) : null;
  }
  async latestApprovedPlan(chcId: string) {
    // Newest first, filtered to approved. DynamoDB applies Limit before the filter, so page until
    // one turns up (a CHC has tens of plan versions a season; usually the first page has it).
    let startKey: Item | undefined;
    do {
      const page = await this.documents.send(
        new QueryCommand({
          TableName: this.table("plans"),
          KeyConditionExpression: "chcId = :chc",
          FilterExpression: "#status = :approved",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":chc": chcId, ":approved": "approved" },
          ScanIndexForward: false,
          ExclusiveStartKey: startKey,
        }),
      );
      const item = (page.Items as Item[] | undefined)?.[0];
      if (item) return fromPlanItem(item);
      startKey = page.LastEvaluatedKey as Item | undefined;
    } while (startKey);
    return null;
  }
  async createPlan(plan: PlanRecord) {
    try {
      await this.documents.send(
        new PutCommand({
          TableName: this.table("plans"),
          Item: { ...plan, planKey: planKey(plan.planDate, plan.version) },
          ConditionExpression: "attribute_not_exists(planKey)",
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new StoreConflictError(`plan ${plan.planDate} v${plan.version} already exists`);
      throw error;
    }
  }
  async beginPublish(
    chcId: string,
    planDate: string,
    version: number,
    approval: { approvedBy: string; approvedAt: string; changes: PlanChanges; publish: PublishWrites },
  ) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("plans"),
          Key: { chcId, planKey: planKey(planDate, version) },
          // Only a draft at exactly this version can start publishing, once.
          ConditionExpression: "attribute_exists(planKey) AND #status = :draft AND #version = :version",
          UpdateExpression: "SET #status = :publishing, approvedAt = :at, approvedBy = :by, changes = :changes, publish = :publish",
          ExpressionAttributeNames: { "#status": "status", "#version": "version" },
          ExpressionAttributeValues: {
            ":draft": "draft",
            ":publishing": "publishing",
            ":version": version,
            ":at": approval.approvedAt,
            ":by": approval.approvedBy,
            ":changes": approval.changes,
            ":publish": approval.publish,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return fromPlanItem(result.Attributes as Item);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new StoreConflictError("plan is not a draft at that version");
      throw error;
    }
  }
  async completePublish(chcId: string, planDate: string, version: number) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("plans"),
          Key: { chcId, planKey: planKey(planDate, version) },
          // Publishing -> approved; repeating it on an approved plan changes nothing.
          ConditionExpression: "attribute_exists(planKey) AND #status IN (:publishing, :approved)",
          UpdateExpression: "SET #status = :approved",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":publishing": "publishing", ":approved": "approved" },
          ReturnValues: "ALL_NEW",
        }),
      );
      return fromPlanItem(result.Attributes as Item);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new StoreConflictError("plan is not being published");
      throw error;
    }
  }

  // --- Work logs and fire checks -----------------------------------------------------------

  async listWorkLogs(chcId: string) {
    return (await this.queryPartition("workLogs", chcId)).map((item) => omit(item, ["logKey"]) as WorkLogRecord);
  }
  async putWorkLog(log: WorkLogRecord) {
    await this.put("workLogs", { ...log, logKey: logKey(log.date, log.machineId, log.fieldId) });
  }
  async listFireChecks(fieldId: string) {
    return (await this.queryPartition("fireChecks", fieldId)) as FireCheckRecord[];
  }
  async putFireCheck(check: FireCheckRecord) {
    await this.put("fireChecks", { ...check });
  }

  // --- Farmers and users -------------------------------------------------------------------

  async getFarmer(farmerId: string) {
    if (!farmerId) return null;
    const item = await this.get("farmers", { farmerId });
    return item ? ({ ...omit(item, ["farmerId"]), id: item.farmerId, facilitatorId: item.facilitatorId ?? null } as FarmerRecord) : null;
  }
  async putFarmer(farmer: FarmerRecord) {
    await this.put("farmers", { ...omit(farmer, ["id"]), farmerId: farmer.id });
  }
  async putLoginToken(record: LoginTokenRecord) {
    // usedAt is absent until the link is used; the conditional update below relies on that.
    await this.put("loginTokens", { ...omit(record, record.usedAt === null ? ["usedAt"] : []), ttl: epochSeconds(record.expiresAt) + 86_400 });
  }
  async useLoginToken(jti: string, usedAt: string) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("loginTokens"),
          Key: { jti },
          ConditionExpression: "attribute_exists(jti) AND attribute_not_exists(usedAt)",
          UpdateExpression: "SET usedAt = :at",
          ExpressionAttributeValues: { ":at": usedAt },
          ReturnValues: "ALL_NEW",
        }),
      );
      return omit(result.Attributes as Item, ["ttl"]) as LoginTokenRecord;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  // --- WhatsApp ----------------------------------------------------------------------------

  async claimInboundMessage(messageId: string, receivedAt: string, expiresAt: string) {
    try {
      await this.documents.send(
        new PutCommand({
          TableName: this.table("whatsappMessages"),
          Item: { messageId, receivedAt, ttl: epochSeconds(expiresAt) },
          // TTL deletion can lag by hours: an expired claim counts as gone.
          ConditionExpression: "attribute_not_exists(messageId) OR #ttl < :now",
          ExpressionAttributeNames: { "#ttl": "ttl" },
          ExpressionAttributeValues: { ":now": epochSeconds(receivedAt) },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
  async putWhatsAppDraft(record: WhatsAppDraftRecord) {
    await this.put("whatsappDrafts", { ...omit(record, record.usedAt === null ? ["usedAt"] : []), ttl: epochSeconds(record.expiresAt) + 86_400 });
  }
  async useWhatsAppDraft(draftId: string, phone: string, at: string) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("whatsappDrafts"),
          Key: { draftId },
          ConditionExpression: "attribute_exists(draftId) AND phone = :phone AND attribute_not_exists(usedAt) AND expiresAt > :at",
          UpdateExpression: "SET usedAt = :at",
          ExpressionAttributeValues: { ":phone": phone, ":at": at },
          ReturnValues: "ALL_NEW",
        }),
      );
      return omit(result.Attributes as Item, ["ttl"]) as WhatsAppDraftRecord;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }
  async putOutboundNotice(record: OutboundNoticeRecord) {
    await this.put("whatsappNotices", { ...record });
  }
  async setNoticeStatus(messageId: string, status: DeliveryStatus, at: string, error: string | null) {
    try {
      await this.documents.send(
        new UpdateCommand({
          TableName: this.table("whatsappNotices"),
          Key: { messageId },
          ConditionExpression: "attribute_exists(messageId) AND statusAt <= :at",
          UpdateExpression: "SET #status = :status, statusAt = :at, #error = :error",
          ExpressionAttributeNames: { "#status": "status", "#error": "error" },
          ExpressionAttributeValues: { ":status": status, ":at": at, ":error": error },
        }),
      );
      return true;
    } catch (caught) {
      if (caught instanceof ConditionalCheckFailedException) return false;
      throw caught;
    }
  }
  async getOutboundNotice(messageId: string) {
    const item = await this.get("whatsappNotices", { messageId });
    return item ? (item as OutboundNoticeRecord) : null;
  }

  // --- Farmer accounts and one-time codes --------------------------------------------------

  async getFarmerAccount(phone: string) {
    if (!phone) return null;
    return (await this.get("farmerAccounts", { phone })) as FarmerAccountRecord | null;
  }
  async createFarmerAccount(record: FarmerAccountRecord) {
    try {
      await this.documents.send(new PutCommand({ TableName: this.table("farmerAccounts"), Item: { ...record }, ConditionExpression: "attribute_not_exists(phone)" }));
      return record;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return (await this.getFarmerAccount(record.phone))!;
      throw error;
    }
  }
  async putFarmerAccount(record: FarmerAccountRecord) {
    await this.put("farmerAccounts", { ...record });
  }
  async putOtpChallenge(record: OtpChallengeRecord) {
    await this.put("otpChallenges", { ...record, ttl: epochSeconds(record.expiresAt) + 3_600 });
  }
  async getOtpChallenge(phone: string) {
    const item = await this.get("otpChallenges", { phone });
    return item ? (omit(item, ["ttl"]) as OtpChallengeRecord) : null;
  }
  async countOtpAttempt(phone: string, seen: number) {
    try {
      await this.documents.send(
        new UpdateCommand({
          TableName: this.table("otpChallenges"),
          Key: { phone },
          ConditionExpression: "attribute_exists(phone) AND attempts = :seen",
          UpdateExpression: "SET attempts = :next",
          ExpressionAttributeValues: { ":seen": seen, ":next": seen + 1 },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }
  async deleteOtpChallenge(phone: string, codeHash: string) {
    try {
      await this.documents.send(
        new DeleteCommand({ TableName: this.table("otpChallenges"), Key: { phone }, ConditionExpression: "codeHash = :hash", ExpressionAttributeValues: { ":hash": codeHash } }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async getUser(userId: string) {
    const item = await this.get("users", { userId });
    return item ? fromUserItem(item) : null;
  }
  async putUser(user: UserRecord) {
    await this.put("users", withoutNullKeys({ ...user }, ["chcId"]));
  }
  async listUsersByChc(chcId: string) {
    const items = await this.queryAll({
      TableName: this.table("users"),
      IndexName: "chc-index",
      KeyConditionExpression: "chcId = :chc",
      ExpressionAttributeValues: { ":chc": chcId },
    });
    return items.map(fromUserItem);
  }

  // --- Demo reset --------------------------------------------------------------------------

  async clearChcData(chcId: string) {
    for (const table of ["machines", "fields", "promises", "plans", "workLogs"] as const) {
      const spec = TABLES[table];
      const sortKey = spec.sortKey.name;
      const keys = await this.queryPartition(table, chcId, {
        ProjectionExpression: "#pk, #sk",
        ExpressionAttributeNames: { "#sk": sortKey },
      });
      for (let start = 0; start < keys.length; start += BATCH_SIZE) {
        let requests: Record<string, { DeleteRequest: { Key: Item } }[]> = {
          [this.table(table)]: keys.slice(start, start + BATCH_SIZE).map((key) => ({ DeleteRequest: { Key: key } })),
        };
        // BatchWrite can return unprocessed items under throttling: retry with backoff.
        for (let attempt = 0; Object.keys(requests).length > 0; attempt += 1) {
          if (attempt > MAX_BATCH_RETRIES) throw new Error(`could not clear ${table} for ${chcId}`);
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
          const result = await this.documents.send(new BatchWriteCommand({ RequestItems: requests }));
          requests = (result.UnprocessedItems as typeof requests | undefined) ?? {};
        }
      }
    }
  }
}

function fromChcItem(item: Item): ChcRecord {
  return { ...omit(item, ["chcId"]), id: item.chcId } as ChcRecord;
}
/**
 * The season clock is one item in the chcs table rather than a table of its own, so a deployment
 * needs no new table; listChcs never returns it. Centre ids are "chc-…", so this key cannot clash.
 */
const SEASON_CLOCK_KEY = "__season-clock";

function fromMachineItem(item: Item): MachineRecord {
  return { ...omit(item, ["machineId"]), id: item.machineId } as MachineRecord;
}
function fromFieldItem(item: Item): FieldRecord {
  return {
    ...omit(item, ["fieldId"]),
    id: item.fieldId,
    bookedBy: item.bookedBy ?? null,
    soonerRequestedAt: item.soonerRequestedAt ?? null,
    // Fields written before phones and link versions existed have none of them.
    farmerPhone: item.farmerPhone ?? null,
    consentAt: item.consentAt ?? null,
    consentBy: item.consentBy ?? null,
    linkVersion: item.linkVersion ?? 1,
  } as FieldRecord;
}
function fromPromiseItem(item: Item): PromiseRecord {
  return omit(item, ["promiseKey"]) as PromiseRecord;
}
/** Plans written before drafts existed said "proposed" and carried no changes; read them as drafts. */
function fromPlanItem(item: Item): PlanRecord {
  const plan = omit(item, ["planKey", "lastReplan", "firmingFieldIds"]);
  return {
    ...plan,
    status: plan.status === "proposed" ? "draft" : plan.status,
    cause: plan.cause ?? "generate",
    causeMachineId: plan.causeMachineId ?? null,
    pins: plan.pins ?? [],
    changes: plan.changes ?? { promised: [], firmed: [], moved: [], broken: [], rePromised: [], unplaced: [] },
    publish: plan.publish ?? null,
  } as PlanRecord;
}
function fromUserItem(item: Item): UserRecord {
  // Users written when farmers still had accounts may carry a farmerId; it is dropped.
  return { ...omit(item, ["farmerId"]), chcId: item.chcId ?? null } as UserRecord;
}
