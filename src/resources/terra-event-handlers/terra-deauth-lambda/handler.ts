import { EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

interface TerraUser {
  user_id: string;
  provider: string;
  last_webhook_update: string | null;
  scopes: string | null;
  reference_id: string;
}

interface Deauth {
  type: 'deauth';
  user: TerraUser;
  status: 'success';
  message: string;
}

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler: EventBridgeHandler<string, Deauth, void> = async (
  event: EventBridgeEvent<string, Deauth>
) => {
  console.log(`debug:\n${JSON.stringify(event.detail)}`);

  try {
    await dbClient.send(
      new DeleteItemCommand({
        TableName: process.env.USER_TABLE!,
        Key: {
          TrueCoachClientId: {
            S: event.detail.user.reference_id,
          },
          TerraUserId: {
            S: event.detail.user.user_id,
          },
        },
      })
    );

    console.log(`User deleted.\n${JSON.stringify(event.detail.user)}`);
  } catch (err) {
    console.log(
      `Error processing webhook deauth event.\n${JSON.stringify(event.detail)}`
    );
    throw err;
  }
};
