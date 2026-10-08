/**
 * DynamoDB DocumentClient. Credentials come only from the AWS SDK default provider chain
 * (environment, shared config/SSO profile, or the ECS task role in production): nothing here reads
 * or logs a key. DYNAMODB_ENDPOINT is optional and only for DynamoDB Local in development.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type DynamoSettings = { region: string; endpoint?: string };

export function createDynamoClients(settings: DynamoSettings) {
  const client = new DynamoDBClient({
    region: settings.region,
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
  });
  const documents = DynamoDBDocumentClient.from(client, {
    // Optional fields are dropped instead of failing the write; nulls are kept as NULL except on
    // index keys, which the store strips (an index key must be a string or absent).
    marshallOptions: { removeUndefinedValues: true },
  });
  return { client, documents };
}
