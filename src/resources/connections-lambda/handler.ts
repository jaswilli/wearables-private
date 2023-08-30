import {
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
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

async function fetchGraphsToken(
  terraUserId: string,
  terraDevId: string,
  terraApiKey: string
): Promise<TerraGraphsTokenResponse | null> {
  const terraApiUrl = 'https://api.tryterra.co/v2';

  try {
    const tokenResponse = await fetch(
      new URL(`${terraApiUrl}/graphs/token?user_id=${terraUserId}`),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'dev-id': terraDevId,
          'x-api-key': terraApiKey,
        },
      }
    );

    if (!tokenResponse.ok) {
      console.log(
        `Error fetching graphs token for ${terraUserId}. Status: ${tokenResponse.status}`
      );

      return null;
    }

    const { token } = await tokenResponse.json();
    return {
      token,
      expires_at: new Date(new Date().getTime() + 840 * 1000).toISOString(),
    };
  } catch (err) {
    console.log(`Error\n${JSON.stringify(err)}`);

    return null;
  }
}

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<
  AuthorizerContext
> = async (
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>
): Promise<APIGatewayProxyResultV2> => {
  const authData = event.requestContext.authorizer.lambda;
  const clientId = event.queryStringParameters?.client_ids || '';

  if (clientId.split(',').length > 1) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'bad_request',
        message: 'Requesting multiple client ids is not currently supported.',
      }),
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Access-Control-Allow-Credentials': true,
      },
    };
  }

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
    new QueryCommand({
      TableName: process.env.USER_TABLE!,
      KeyConditionExpression: 'TrueCoachClientId = :client_id',
      ExpressionAttributeValues: {
        ':client_id': {
          S: clientId,
        },
      },
    })
  );

  const items = result.Items ?? [];
  const users: Array<UserTableItem> = items.map((data) => {
    return {
      truecoachClientId: data.TrueCoachClientId.S!,
      terraUserId: data.TerraUserId.S!,
      provider: data.Provider.S!,
      created_at: data.CreatedAt.S!,
    };
  });

  console.log(`debug: ${JSON.stringify(result)}`);
  console.log(`debug: terra user_id: ${JSON.stringify(items[0].TerraUserId)}`);

  const connections: Array<Connection> = [];
  const includeGraphsToken = event.queryStringParameters?.include
    ?.split(',')
    .includes('graphs_token');
  if (includeGraphsToken) {
    const secretPayload = await getSecret(TERRA_CREDENTIALS_SECRET);

    const { devId, apiKey } = JSON.parse(
      secretPayload.SecretString!
    ) as TerraCredentialsSecret;

    for (const user of users) {
      connections.push({
        client_id: user.truecoachClientId,
        provider: user.provider,
        created_at: user.created_at,
        graphs_token: await fetchGraphsToken(user.terraUserId, devId, apiKey),
      });
    }
  } else {
    for (const user of users) {
      connections.push({
        client_id: user.truecoachClientId,
        provider: user.provider,
        created_at: user.created_at,
        graphs_token: null,
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ data: connections }),
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'OPTIONS,GET',
      'Access-Control-Allow-Credentials': true,
    },
  };
};
