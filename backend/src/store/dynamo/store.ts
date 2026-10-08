/**
 * VaariStore on DynamoDB, one table per entity (see tables.ts and docs/DECISIONS.md).
 * Every hot-path read is a GetItem or a single-partition Query on the CHC; there are no scans
 * except listChcs (a handful of rows). Records keep their app field names; the table key
 * attributes (chcId, fieldId, promiseKey, …) are added on write and stripped on read.
 */
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
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
  type FieldRecord,
  type FireCheckRecord,
  type MachineRecord,
  type PlanRecord,
  type PromiseRecord,
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
    return items.map(fromChcItem).sort((left, right) => (left.id < right.id ? -1 : 1));
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

  // --- Fields ------------------------------------------------------------------------------

  async listFields(chcId: string) {
    return (await this.queryPartition("fields", chcId)).map(fromFieldItem);
  }
  async getField(chcId: string, fieldId: string) {
    const item = await this.get("fields", { chcId, fieldId });
    return item ? fromFieldItem(item) : null;
  }
  async putField(field: FieldRecord) {
    await this.put("fields", withoutNullKeys({ ...omit(field, ["id"]), fieldId: field.id }, ["bookedBy"]));
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
  async approvePlan(chcId: string, planDate: string, version: number, approvedBy: string, approvedAt: string) {
    try {
      const result = await this.documents.send(
        new UpdateCommand({
          TableName: this.table("plans"),
          Key: { chcId, planKey: planKey(planDate, version) },
          // Only a proposed plan at exactly this version can be approved, once.
          ConditionExpression: "attribute_exists(planKey) AND #status = :proposed AND #version = :version",
          UpdateExpression: "SET #status = :approved, approvedAt = :at, approvedBy = :by, firmingFieldIds = :none",
          ExpressionAttributeNames: { "#status": "status", "#version": "version" },
          ExpressionAttributeValues: { ":proposed": "proposed", ":approved": "approved", ":version": version, ":at": approvedAt, ":by": approvedBy, ":none": [] },
          ReturnValues: "ALL_NEW",
        }),
      );
      return fromPlanItem(result.Attributes as Item);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new StoreConflictError("plan is not a proposed plan at that version");
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
    const item = await this.get("farmers", { farmerId });
    return item ? ({ ...omit(item, ["farmerId"]), id: item.farmerId, facilitatorId: item.facilitatorId ?? null } as FarmerRecord) : null;
  }
  async putFarmer(farmer: FarmerRecord) {
    await this.put("farmers", { ...omit(farmer, ["id"]), farmerId: farmer.id });
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
function fromMachineItem(item: Item): MachineRecord {
  return { ...omit(item, ["machineId"]), id: item.machineId } as MachineRecord;
}
function fromFieldItem(item: Item): FieldRecord {
  return { ...omit(item, ["fieldId"]), id: item.fieldId, bookedBy: item.bookedBy ?? null } as FieldRecord;
}
function fromPromiseItem(item: Item): PromiseRecord {
  return omit(item, ["promiseKey"]) as PromiseRecord;
}
function fromPlanItem(item: Item): PlanRecord {
  return { ...omit(item, ["planKey"]), lastReplan: item.lastReplan ?? null } as PlanRecord;
}
function fromUserItem(item: Item): UserRecord {
  return { ...item, chcId: item.chcId ?? null, farmerId: item.farmerId ?? null } as UserRecord;
}
