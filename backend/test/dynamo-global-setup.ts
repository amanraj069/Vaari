/** Creates the -test tables (idempotent) before integration tests run. Never runs for other prefixes. */
import { createDynamoClients } from "../src/store/dynamo/client";
import { ensureTables } from "../src/store/dynamo/admin";

export default async function setup() {
  const prefix = process.env.TABLE_PREFIX ?? "";
  if (!prefix.endsWith("-test")) throw new Error(`refusing to set up tables for TABLE_PREFIX=${prefix}`);
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("integration tests need AWS_REGION");
  const { client } = createDynamoClients({ region, endpoint: process.env.DYNAMODB_ENDPOINT });
  await ensureTables(client, prefix);
}
