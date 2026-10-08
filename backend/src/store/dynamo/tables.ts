/**
 * The DynamoDB tables, one per entity, named `${TABLE_PREFIX}-<name>`, on-demand billing.
 * This is the single source of truth for keys and indexes: `npm run db:create` builds from it and
 * the store reads key names from it. Sort keys that embed a version zero-pad it, so "…#000010"
 * sorts after "…#000002" (DynamoDB compares sort keys as strings).
 */
export type KeySpec = { name: string; type: "S" | "N" };
export type IndexSpec = { indexName: string; partitionKey: KeySpec; sortKey?: KeySpec };
export type TableSpec = { name: string; partitionKey: KeySpec; sortKey?: KeySpec; indexes: IndexSpec[] };

const S = (name: string): KeySpec => ({ name, type: "S" });

export const TABLES = {
  users: { name: "users", partitionKey: S("userId"), indexes: [{ indexName: "chc-index", partitionKey: S("chcId"), sortKey: S("role") }] },
  farmers: { name: "farmers", partitionKey: S("farmerId"), indexes: [] },
  chcs: { name: "chcs", partitionKey: S("chcId"), indexes: [] },
  machines: { name: "machines", partitionKey: S("chcId"), sortKey: S("machineId"), indexes: [] },
  fields: {
    name: "fields",
    partitionKey: S("chcId"),
    sortKey: S("fieldId"),
    indexes: [{ indexName: "booked-by-index", partitionKey: S("bookedBy"), sortKey: S("createdAt") }],
  },
  promises: { name: "promises", partitionKey: S("chcId"), sortKey: S("promiseKey"), indexes: [] },
  plans: { name: "plans", partitionKey: S("chcId"), sortKey: S("planKey"), indexes: [] },
  workLogs: { name: "work-logs", partitionKey: S("chcId"), sortKey: S("logKey"), indexes: [] },
  fireChecks: { name: "fire-checks", partitionKey: S("fieldId"), sortKey: S("checkDate"), indexes: [] },
} satisfies Record<string, TableSpec>;

export type TableKey = keyof typeof TABLES;

export function tableName(prefix: string, table: TableKey): string {
  return `${prefix}-${TABLES[table].name}`;
}

const VERSION_DIGITS = 6;
export const padVersion = (version: number) => String(version).padStart(VERSION_DIGITS, "0");
export const promiseKey = (fieldId: string, version: number) => `${fieldId}#${padVersion(version)}`;
export const planKey = (planDate: string, version: number) => `${planDate}#${padVersion(version)}`;
export const logKey = (date: string, machineId: string, fieldId: string) => `${date}#${machineId}#${fieldId}`;
