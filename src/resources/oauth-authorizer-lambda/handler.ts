import {
  APIGatewayRequestSimpleAuthorizerHandlerV2WithContext,
  APIGatewaySimpleAuthorizerWithContextResult,
} from 'aws-lambda';
import { getSecret } from '../../shared/auth';

export interface AuthorizerContext {
  accessToken: string;
  iat?: string;
  username?: string;
  scope?: string;
  sub?: string;
  token_type?: string;
  user_client_id?: number | null;
  user_trainer_id?: number | null;
}

interface TokenIntrospectResponse extends AuthorizerContext {
  active: boolean;
}

interface TrueCoachClientCredentials {
  clientId: string;
  secret: string;
}

export const handler: APIGatewayRequestSimpleAuthorizerHandlerV2WithContext<
  AuthorizerContext
> = async (
  event
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthorizerContext>> => {
  const secretPayload = await getSecret(
    process.env.TRUECOACH_CLIENT_CREDENTIALS_SECRET!
  );
  const { clientId, secret } = JSON.parse(
    secretPayload.SecretString!
  ) as TrueCoachClientCredentials;

  const accessToken = event.identitySource[0].slice(7);

  const response = await fetch(
    `https://api-staging.truecoach.co/api/oauth/token/introspect`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString(
          'base64'
        )}`,
      },
      body: new URLSearchParams({
        token: accessToken,
      }),
    }
  );

  const introspectData: TokenIntrospectResponse = await response.json();

  if (introspectData.active === false) {
    throw new Error('Unauthorized');
  }

  return {
    isAuthorized: introspectData.active,
    context: {
      accessToken,
      iat: introspectData.iat,
      username: introspectData.username,
      scope: introspectData.scope,
      sub: introspectData.sub,
      user_client_id: introspectData.user_client_id,
      user_trainer_id: introspectData.user_trainer_id,
    },
  };
};
