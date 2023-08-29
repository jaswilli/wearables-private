import {
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { AuthorizerContext } from '../oauth-authorizer-lambda/handler';
import { getSecret } from '../../shared/auth';

interface TerraCredentialsSecret {
  devId: string;
  apiKey: string;
}

const TERRA_CREDENTIALS_SECRET = process.env.TERRA_CREDENTIALS_SECRET!;

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<
  AuthorizerContext
> = async (
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>
): Promise<APIGatewayProxyResultV2> => {
  const terraApiUrl = 'https://api.tryterra.co/v2';

  const authData = event.requestContext.authorizer.lambda;
  const clientId = event.queryStringParameters?.client_id || '';

  let forbidden = true;
  if (authData.user_client_id?.toString() === clientId) {
    forbidden = false;
  } else if (
    authData.user_trainer_id &&
    authData.scope?.split(' ').includes('trainer')
  ) {
    const tcResponse = await fetch(
      new URL(`https://${process.env.TC_API_DOMAIN}/api/clients/${clientId}`),
      {
        method: 'GET',
        headers: {
          role: 'Trainer',
          Authorization: `Bearer ${event.headers.authorization}`,
        },
      }
    );

    if (tcResponse.ok) {
      forbidden = false;
    }
  }

  if (forbidden) {
    return {
      statusCode: 403,
    };
  }

  const result = await dbClient.send(
    new GetItemCommand({
      TableName: process.env.USER_TABLE!,
      Key: {
        TrueCoachClientId: {
          S: clientId,
        },
      },
    })
  );

  const secretPayload = await getSecret(TERRA_CREDENTIALS_SECRET);

  const { devId, apiKey } = JSON.parse(
    secretPayload.SecretString!
  ) as TerraCredentialsSecret;

  console.log(`debug: ${JSON.stringify(result)}`);
  console.log(`debug: terra user_id: ${result.Item?.TerraUserId}`);

  const tokenResponse = await fetch(
    new URL(
      `${terraApiUrl}/graphs/token?user_id=${result.Item?.TerraUserId?.S}`
    ),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'dev-id': devId,
        'x-api-key': apiKey,
      },
    }
  );

  const tokenResponseJSON = await tokenResponse.json();

  if (tokenResponse.ok) {
    console.log(`Retrieved graphs token for TrueCoach client ${clientId}.`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: {
          token: tokenResponseJSON.token,
          expires_at: new Date(new Date().getTime() + 840 * 1000).toISOString(),
        },
      }),
    };
  } else {
    console.log('Error\n', JSON.stringify(tokenResponseJSON));

    return {
      statusCode: 500,
    };
  }
};
