/**
 * Table administration for `npm run db:create` / `db:status` and the integration tests.
 * ensureTables is idempotent: it creates only the tables and indexes that do not exist yet,
 * waits until each is ACTIVE, and reports what it did. destroyTables refuses vaari-prod.
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  UpdateTableCommand,
  waitUntilTableNotExists,
  type AttributeDefinition,
  type DynamoDBClient,
  type GlobalSecondaryIndex,
  type TableDescription,
} from "@aws-sdk/client-dynamodb";
import { ScanCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tableName, TABLES, type IndexSpec, type TableKey, type TableSpec } from "./tables";

export const PROTECTED_PREFIX = "vaari-prod";
const POLL_MILLISECONDS = 2_000;
const WAIT_LIMIT_MILLISECONDS = 10 * 60_000;

export function assertSafePrefix(prefix: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(prefix)) throw new Error(`TABLE_PREFIX "${prefix}" must be lowercase letters, digits and dashes`);
}

async function describe(client: DynamoDBClient, name: string): Promise<TableDescription | null> {
  try {
    return (await client.send(new DescribeTableCommand({ TableName: name }))).Table ?? null;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return null;
    throw error;
  }
}

function indexDefinition(index: IndexSpec): GlobalSecondaryIndex {
  return {
    IndexName: index.indexName,
    KeySchema: [
      { AttributeName: index.partitionKey.name, KeyType: "HASH" },
      ...(index.sortKey ? [{ AttributeName: index.sortKey.name, KeyType: "RANGE" as const }] : []),
    ],
    Projection: { ProjectionType: "ALL" },
  };
}

function attributeDefinitions(spec: TableSpec, indexes: IndexSpec[]): AttributeDefinition[] {
  const keys = [spec.partitionKey, spec.sortKey, ...indexes.flatMap((index) => [index.partitionKey, index.sortKey])].filter(
    (key): key is NonNullable<typeof key> => Boolean(key),
  );
  const unique = new Map(keys.map((key) => [key.name, key.type]));
  return [...unique].map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType }));
}

/** Waits until the table and all its indexes are ACTIVE (index creation is asynchronous). */
async function waitUntilActive(client: DynamoDBClient, name: string) {
  const started = Date.now();
  for (;;) {
    const table = await describe(client, name);
    const indexesActive = (table?.GlobalSecondaryIndexes ?? []).every((index) => index.IndexStatus === "ACTIVE");
    if (table?.TableStatus === "ACTIVE" && indexesActive) return;
    if (Date.now() - started > WAIT_LIMIT_MILLISECONDS) throw new Error(`${name} did not become ACTIVE in time`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MILLISECONDS));
  }
}

export type Report = (line: string) => void;

export async function ensureTables(client: DynamoDBClient, prefix: string, report: Report = () => {}) {
  assertSafePrefix(prefix);
  for (const key of Object.keys(TABLES) as TableKey[]) {
    const spec: TableSpec = TABLES[key];
    const name = tableName(prefix, key);
    const existing = await describe(client, name);
    if (!existing) {
      await client.send(
        new CreateTableCommand({
          TableName: name,
          BillingMode: "PAY_PER_REQUEST",
          KeySchema: [
            { AttributeName: spec.partitionKey.name, KeyType: "HASH" },
            ...(spec.sortKey ? [{ AttributeName: spec.sortKey.name, KeyType: "RANGE" as const }] : []),
          ],
          AttributeDefinitions: attributeDefinitions(spec, spec.indexes),
          ...(spec.indexes.length ? { GlobalSecondaryIndexes: spec.indexes.map(indexDefinition) } : {}),
        }),
      );
      report(`created  ${name}${spec.indexes.length ? ` (indexes: ${spec.indexes.map((index) => index.indexName).join(", ")})` : ""}`);
      await waitUntilActive(client, name);
      report(`active   ${name}`);
      continue;
    }
    // Table exists: add any index it is missing, one at a time (DynamoDB allows one GSI creation per update).
    const present = new Set((existing.GlobalSecondaryIndexes ?? []).map((index) => index.IndexName));
    const missing = spec.indexes.filter((index) => !present.has(index.indexName));
    for (const index of missing) {
      await waitUntilActive(client, name);
      await client.send(
        new UpdateTableCommand({
          TableName: name,
          AttributeDefinitions: attributeDefinitions(spec, [index]),
          GlobalSecondaryIndexUpdates: [{ Create: indexDefinition(index) }],
        }),
      );
      report(`added    ${name} index ${index.indexName}`);
    }
    await waitUntilActive(client, name);
    report(missing.length ? `active   ${name}` : `exists   ${name}`);
  }
}

export async function tableStatus(client: DynamoDBClient, documents: DynamoDBDocumentClient, prefix: string) {
  const rows: { table: string; status: string; items: number | null; indexes: string }[] = [];
  for (const key of Object.keys(TABLES) as TableKey[]) {
    const name = tableName(prefix, key);
    const table = await describe(client, name);
    if (!table) {
      rows.push({ table: name, status: "MISSING", items: null, indexes: "" });
      continue;
    }
    // Exact count with a paged COUNT scan (DescribeTable's ItemCount is refreshed only about every 6 hours).
    let items = 0;
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await documents.send(new ScanCommand({ TableName: name, Select: "COUNT", ExclusiveStartKey: startKey }));
      items += page.Count ?? 0;
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    const indexes = (table.GlobalSecondaryIndexes ?? []).map((index) => `${index.IndexName}:${index.IndexStatus}`).join(", ");
    rows.push({ table: name, status: table.TableStatus ?? "UNKNOWN", items, indexes });
  }
  return rows;
}

export async function destroyTables(client: DynamoDBClient, prefix: string, report: Report = () => {}) {
  assertSafePrefix(prefix);
  if (prefix === PROTECTED_PREFIX) throw new Error(`Refusing to delete tables with TABLE_PREFIX=${PROTECTED_PREFIX}`);
  for (const key of Object.keys(TABLES) as TableKey[]) {
    const name = tableName(prefix, key);
    if (!(await describe(client, name))) continue;
    await client.send(new DeleteTableCommand({ TableName: name }));
    await waitUntilTableNotExists({ client, maxWaitTime: 300 }, { TableName: name });
    report(`deleted  ${name}`);
  }
}
