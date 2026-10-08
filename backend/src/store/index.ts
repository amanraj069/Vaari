/** Picks the store from REPO: DynamoDB tables (`${TABLE_PREFIX}-*`) or in memory. */
import type { Config } from "../config";
import { createDynamoClients } from "./dynamo/client";
import { DynamoStore } from "./dynamo/store";
import { MemoryStore } from "./memory";
import type { VaariStore } from "./types";

export function createStore(config: Config): VaariStore {
  if (config.REPO === "memory") return new MemoryStore();
  const { documents } = createDynamoClients({ region: config.AWS_REGION!, endpoint: config.DYNAMODB_ENDPOINT });
  return new DynamoStore(documents, config.TABLE_PREFIX);
}
