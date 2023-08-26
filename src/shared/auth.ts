import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GetSecretResult {
  ARN: string;
  CreatedDate: string;
  Name: string;
  SecretBinary: string | null;
  SecretString: string | null;
  VersionId: string;
  VersionStages: Array<string>;
  ResultMetadata: unknown;
}

export async function getSecret(secretArn: string): Promise<GetSecretResult> {
  const url = `http://localhost:${process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT}/secretsmanager/get?secretId=${secretArn}`;

  const response = await fetch(url, {
    headers: {
      'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN!,
    },
  });

  return response.json();
}

export function verifyTerraMessage(
  signature: string,
  message: string,
  secret: string
): boolean {
  const [t, v1] = signature.split(',').map((part) => part.split('=')[1]);
  const hmac = createHmac('sha256', secret)
    .update(`${t}.${message}`)
    .digest('hex');

  return timingSafeEqual(Buffer.from(v1), Buffer.from(hmac));
}
