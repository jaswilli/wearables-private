import {
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  DynamoDBClient,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { AuthorizerContext } from '../oauth-authorizer-lambda/handler';
import { getSecret } from '../../shared/auth';

interface TerraCredentialsSecret {
  devId: string;
  apiKey: string;
}

interface TerraGraphsTokenResponse {
  token: string;
  expires_at: string;
}

interface Connection {
  client_id: string;
  provider: string;
  graphs_token: TerraGraphsTokenResponse | null;
  created_at: string;
}

interface UserTableItem {
  truecoachClientId: string;
  terraUserId: string;
  provider: string;
  created_at: string;
}

const TERRA_CREDENTIALS_SECRET = process.env.TERRA_CREDENTIALS_SECRET!;

const dbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<
  AuthorizerContext
> = async (
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>
): Promise<APIGatewayProxyResultV2> => {
  const authData = event.requestContext.authorizer.lambda;
  const clientId = event.queryStringParameters?.client_id || '';
  const provider = event.queryStringParameters?.provider || '';

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
          Authorization: `Bearer ${event.headers.authorization?.slice(7)}`,
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
    new QueryCommand({
      TableName: process.env.USER_TABLE!,
      KeyConditionExpression: 'TrueCoachClientId = :client_id',
      FilterExpression: 'Provider = :provider',
      ExpressionAttributeValues: {
        ':client_id': {
          S: clientId,
        },
        ':provider': {
          S: provider,
        },
      },
    })
  );

  console.log(`debug: ${JSON.stringify(result)}`);

  let item;
  if (result.Items?.length) {
    item = result.Items?.[0];
    console.log(
      `Found connection for ${clientId} and ${provider}\n${JSON.stringify(
        item
      )}`
    );
  } else {
    return {
      statusCode: 404,
    };
  }

  const secretPayload = await getSecret(TERRA_CREDENTIALS_SECRET);

  const { devId, apiKey } = JSON.parse(
    secretPayload.SecretString!
  ) as TerraCredentialsSecret;

  const terraApiUrl = 'https://api.tryterra.co/v2';
  const response = await fetch(
    `${terraApiUrl}/auth/deauthenticateUser?user_id=${item.TerraUserId.S}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'dev-id': devId,
        'x-api-key': apiKey,
      },
    }
  );

  if (response.ok) {
    console.log(
      `Successfully deauthenticated user ${item.TerraUserId.S} from Terra`
    );
    await dbClient.send(
      new DeleteItemCommand({
        TableName: process.env.USER_TABLE!,
        Key: {
          TrueCoachClientId: { S: clientId },
          TerraUserId: { S: item.TerraUserId.S! },
        },
      })
    );

    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,DELETE',
        'Access-Control-Allow-Credentials': true,
      },
    };
  } else {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,DELETE',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify(await response.json()),
    };
  }
};
