import {
  APIGatewayProxyHandlerV2WithLambdaAuthorizer,
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { AuthorizerContext } from '../oauth-authorizer-lambda/handler';
import { getSecret, TerraCredentialsSecret } from '../../shared/auth';

const TERRA_CREDENTIALS_SECRET = process.env.TERRA_CREDENTIALS_SECRET!;

export const handler: APIGatewayProxyHandlerV2WithLambdaAuthorizer<
  AuthorizerContext
> = async (
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>
): Promise<APIGatewayProxyResultV2> => {
  const terraApiUrl = 'https://api.tryterra.co/v2';

  const authData = event.requestContext.authorizer.lambda;

  const secretPayload = await getSecret(TERRA_CREDENTIALS_SECRET);

  const { devId, apiKey } = JSON.parse(
    secretPayload.SecretString!
  ) as TerraCredentialsSecret;

  let requestBody;
  try {
    requestBody = JSON.parse(event.body!);
  } catch {
    /* empty */
  }

  const response = await fetch(`${terraApiUrl}/auth/generateWidgetSession`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'dev-id': devId,
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      reference_id: authData.user_client_id,
      auth_success_redirect_url: requestBody?.success_redirect_url,
      auth_failure_redirect_url: requestBody?.failure_redirect_url,
      language: 'en',
      show_disconnect: true,
      use_terra_avengers_app: false,
    }),
  });

  const responseJSON = await response.json();

  if (response.ok && responseJSON.status === 'success') {
    console.log(
      `Created widget session ${responseJSON.session_id} for TrueCoach client ${authData.user_client_id}.`
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'OPTIONS,POST',
        'Access-Control-Allow-Credentials': true,
      },
      body: JSON.stringify({
        data: {
          url: responseJSON.url,
          expires_at: new Date(
            new Date().getTime() + (responseJSON.expires_in - 120) * 1000
          ).toISOString(),
        },
      }),
    };
  } else {
    console.log('Error', JSON.stringify(responseJSON));

    return {
      statusCode: 500,
    };
  }
};
