/**
 * Table admin.
 *   npm run db:create            create missing tables and indexes, wait until ACTIVE (idempotent)
 *   npm run db:status            list tables, status, indexes and exact item counts
 *   npx tsx scripts/db.ts --destroy   delete this prefix's tables (refused for vaari-prod)
 * Reads AWS_REGION, TABLE_PREFIX and optional DYNAMODB_ENDPOINT from the environment (or .env).
 * Credentials come only from the AWS default provider chain; nothing is printed except table names.
 */
import { createDynamoClients } from "../src/store/dynamo/client";
import { destroyTables, ensureTables, PROTECTED_PREFIX, tableStatus } from "../src/store/dynamo/admin";

const prefix = process.env.TABLE_PREFIX ?? "vaari-dev";
const region = process.env.AWS_REGION;
const endpoint = process.env.DYNAMODB_ENDPOINT;
const command = process.argv[2];
const destroyFlag = process.argv.includes("--destroy");

if (!region) {
  console.error("Set AWS_REGION (for example in backend/.env).");
  process.exit(1);
}
const { client, documents } = createDynamoClients({ region, endpoint });
const target = `${prefix}-* in ${region}${endpoint ? ` at ${endpoint}` : ""}`;

try {
  if (destroyFlag) {
    if (prefix === PROTECTED_PREFIX) throw new Error(`Refusing: TABLE_PREFIX is ${PROTECTED_PREFIX}.`);
    console.log(`Deleting ${target}`);
    await destroyTables(client, prefix, (line) => console.log(`  ${line}`));
  } else if (command === "create") {
    console.log(`Ensuring tables ${target}`);
    await ensureTables(client, prefix, (line) => console.log(`  ${line}`));
    console.log("Done.");
  } else if (command === "status") {
    console.log(`Tables ${target}`);
    const rows = await tableStatus(client, documents, prefix);
    const width = Math.max(...rows.map((row) => row.table.length));
    for (const row of rows) {
      console.log(`  ${row.table.padEnd(width)}  ${row.status.padEnd(8)}  ${row.items === null ? "-" : String(row.items).padStart(6)} items  ${row.indexes}`);
    }
  } else {
    console.error("usage: tsx scripts/db.ts create | status | --destroy");
    process.exit(2);
  }
} catch (error) {
  // Print only the message: SDK errors can carry request metadata we do not want in logs.
  console.error(`db ${command ?? ""} failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  process.exit(1);
}
