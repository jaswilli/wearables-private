import { EventBridgeEvent, EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

interface TerraUser {
  user_id: string;
  provider: string;
  last_webhook_update: string | null;
  scopes: string | null;
  reference_id: string;
}

interface AuthSuccess {
  type: 'auth';
  user: TerraUser;
  status: 'success';
  reference_id: string;
  widget_session_id: string;
}

interface AuthError {
  type: 'auth';
  user: TerraUser;
  status: 'error';
  message: string;
  reason: string;
  reference_id: string | null;
  widget_session_id: string | null;
}

async function handleSuccess(detail: AuthSuccess): Promise<void> {
  console.log(`debug: ${detail}`);

  try {
    await dbClient.send(
      new PutItemCommand({
        TableName: process.env.USER_TABLE!,
        Item: {
          TrueCoachClientId: {
            S: detail.reference_id,
          },
          TerraUserId: {
            S: detail.user.user_id,
          },
          Provider: {
            S: detail.user.provider,
          },
          CreatedAt: {
            S: new Date().toISOString(),
          },
        },
      })
    );
  } catch (err) {
    console.log('Error processing webhook auth success event');
    throw err;
  }
}

function handleError(detail: AuthError): void {
  console.log('Terra auth event failure:\n', JSON.stringify(detail));
}

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler: EventBridgeHandler<
  string,
  AuthSuccess | AuthError,
  void
> = async (event: EventBridgeEvent<string, AuthSuccess | AuthError>) => {
  if (event.detail.status === 'success') {
    return handleSuccess(event.detail);
  } else {
    return handleError(event.detail);
  }
};
