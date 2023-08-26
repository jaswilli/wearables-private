import {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { getSecret, verifyTerraMessage } from '../../shared/auth';
import {
  BadRequestError,
  UnauthorizedError,
  WearablesHttpError,
} from '../../shared/errors';

const TERRA_SIGNING_SECRET_SECRET = process.env.TERRA_SIGNING_SECRET_SECRET!;

const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });

function authorizeRequest(
  signingSecret: string,
  signatureHeader?: string,
  requestBody?: string
): boolean {
  if (!signatureHeader) {
    throw new BadRequestError('terra-signature header missing.');
  }

  if (!requestBody) {
    throw new BadRequestError('Request body empty.');
  }

  try {
    if (verifyTerraMessage(signatureHeader, requestBody, signingSecret)) {
      return true;
    }
  } catch (err) {
    throw new UnauthorizedError();
  }

  return false;
}

export const handler: APIGatewayProxyHandlerV2 = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const secretPayload = await getSecret(TERRA_SIGNING_SECRET_SECRET);
  const { signingSecret } = JSON.parse(secretPayload.SecretString!);

  // debug
  console.log(JSON.stringify(event.body));

  try {
    authorizeRequest(
      signingSecret,
      event.headers['terra-signature'],
      event.body
    );
  } catch (err) {
    if (err instanceof WearablesHttpError) {
      return {
        statusCode: err.httpStatus,
        body: JSON.stringify({
          code: err.code,
          message: err.message,
        }),
      };
    }

    throw err;
  }

  try {
    const res = await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Detail: event.body,
            DetailType: 'TerraWebhook',
            Source: `WearablesApi-${process.env.TARGET}`,
            EventBusName: `WearablesEventBus-${process.env.TARGET}`,
          },
        ],
      })
    );

    console.log('Handled event: ', res);

    return {
      statusCode: 204,
    };
  } catch (err) {
    console.log('Error', err);

    const response: APIGatewayProxyResultV2 = {
      statusCode: 500,
    };

    if (err instanceof Error) {
      response.body = JSON.stringify({ message: err.message });
    }

    return response;
  }
};
