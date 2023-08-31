import * as cdk from 'aws-cdk-lib';
import { Duration, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import {
  HttpLambdaAuthorizer,
  HttpLambdaResponseType,
} from '@aws-cdk/aws-apigatewayv2-authorizers-alpha';
import * as eventbridge from 'aws-cdk-lib/aws-events';
import * as eventbridgeTargets from 'aws-cdk-lib/aws-events-targets';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, Charset } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface WearablesStackProps extends StackProps {
  readonly target: 'production' | 'staging';
  readonly apiGatewayDomain: string;
  readonly truecoachApiDomain: string;
}

export class WearablesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WearablesStackProps) {
    super(scope, id, props);

    // route53
    const zone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: props.apiGatewayDomain,
    });

    new route53.CaaAmazonRecord(this, 'CAA', {
      zone,
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.apiGatewayDomain,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const domainName = new apigwv2.DomainName(this, 'DomainName', {
      domainName: zone.zoneName,
      certificate,
    });

    new route53.ARecord(this, 'ApiGatewayAliasRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          domainName.regionalDomainName,
          domainName.regionalHostedZoneId
        )
      ),
    });
    // End route53 zone

    // secrets manager
    const truecoachClientCredentialsSecret = new secretsmanager.Secret(
      this,
      'TrueCoachClientCredentials',
      {
        secretName: `${props.target}/truecoachClientCredentials`,
      }
    );

    const terraCredentialsSecret = new secretsmanager.Secret(
      this,
      'TerraCredentials',
      {
        secretName: `${props.target}/terraCredentials`,
      }
    );

    const terraSigningSecretSecret = new secretsmanager.Secret(
      this,
      'TerraSigningSecret',
      {
        secretName: `${props.target}/terraSigningSecret`,
      }
    );
    // end secrets manager

    // dynamodb
    const userTable = new dynamodb.Table(this, 'User', {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'TrueCoachClientId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'TerraUserId',
        type: dynamodb.AttributeType.STRING,
      },
    });
    // end dynamodb

    // lambda
    const paramsAndSecrets = lambda.ParamsAndSecretsLayerVersion.fromVersion(
      lambda.ParamsAndSecretsVersions.V1_0_103
    );

    const connectWidgetSessionFn = new NodejsFunction(
      this,
      `ConnectWidgetSessionLambda`,
      {
        entry: path.join(
          __dirname,
          '../src/resources/connect-widget-session-lambda/handler.ts'
        ),
        runtime: lambda.Runtime.NODEJS_18_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        logRetention: RetentionDays.ONE_MONTH,
        bundling: {
          forceDockerBundling: true,
          minify: true,
          sourceMap: true,
          charset: Charset.UTF8,
        },
        paramsAndSecrets,
        environment: {
          TERRA_CREDENTIALS_SECRET: terraCredentialsSecret.secretArn,
        },
      }
    );

    terraCredentialsSecret.grantRead(connectWidgetSessionFn);

    const connectionsFn = new NodejsFunction(this, `ConnectionsLambda`, {
      entry: path.join(
        __dirname,
        '../src/resources/connections-lambda/handler.ts'
      ),
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        forceDockerBundling: true,
        minify: true,
        sourceMap: true,
        charset: Charset.UTF8,
      },
      paramsAndSecrets,
      environment: {
        TERRA_CREDENTIALS_SECRET: terraCredentialsSecret.secretArn,
        USER_TABLE: userTable.tableName,
        TC_API_DOMAIN: props.truecoachApiDomain,
      },
    });

    terraCredentialsSecret.grantRead(connectionsFn);
    userTable.grantReadData(connectionsFn);

    const oauthAuthorizerFn = new NodejsFunction(
      this,
      'OauthAuthorizerLambda',
      {
        entry: path.join(
          __dirname,
          '../src/resources/oauth-authorizer-lambda/handler.ts'
        ),
        runtime: lambda.Runtime.NODEJS_18_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        logRetention: RetentionDays.ONE_MONTH,
        bundling: {
          forceDockerBundling: true,
          minify: true,
          sourceMap: true,
          charset: Charset.UTF8,
        },
        paramsAndSecrets,
        environment: {
          TRUECOACH_CLIENT_CREDENTIALS_SECRET:
            truecoachClientCredentialsSecret.secretArn,
          TC_API_DOMAIN: props.truecoachApiDomain,
        },
      }
    );

    truecoachClientCredentialsSecret.grantRead(oauthAuthorizerFn);

    const terraWebhookRequestHandlerFn = new NodejsFunction(
      this,
      'TerraWebhookRequestHandlerLambda',
      {
        entry: path.join(
          __dirname,
          '../src/resources/terra-webhook-request-handler-lambda/handler.ts'
        ),
        runtime: lambda.Runtime.NODEJS_18_X,
        memorySize: 128,
        timeout: Duration.seconds(10),
        logRetention: RetentionDays.ONE_MONTH,
        bundling: {
          forceDockerBundling: true,
          minify: true,
          sourceMap: true,
          charset: Charset.UTF8,
        },
        paramsAndSecrets,
        environment: {
          TARGET: props.target,
          TERRA_SIGNING_SECRET_SECRET: terraSigningSecretSecret.secretArn,
        },
      }
    );

    terraSigningSecretSecret.grantRead(terraWebhookRequestHandlerFn);

    const terraAuthFn = new NodejsFunction(this, 'TerraAuthLambda', {
      entry: path.join(
        __dirname,
        '../src/resources/terra-event-handlers/terra-auth-lambda/handler.ts'
      ),
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        forceDockerBundling: true,
        minify: true,
        sourceMap: true,
        charset: Charset.UTF8,
      },
      paramsAndSecrets,
      environment: {
        USER_TABLE: userTable.tableName,
      },
    });

    userTable.grantReadWriteData(terraAuthFn);

    const terraDeauthFn = new NodejsFunction(this, 'TerraDeauthLambda', {
      entry: path.join(
        __dirname,
        '../src/resources/terra-event-handlers/terra-deauth-lambda/handler.ts'
      ),
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 128,
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.ONE_MONTH,
      bundling: {
        forceDockerBundling: true,
        minify: true,
        sourceMap: true,
        charset: Charset.UTF8,
      },
      paramsAndSecrets,
      environment: {
        USER_TABLE: userTable.tableName,
      },
    });

    userTable.grantReadWriteData(terraDeauthFn);
    // end lambda

    // eventbridge
    const eventBus = new eventbridge.EventBus(this, 'WearablesEventBus', {
      eventBusName: `WearablesEventBus-${props.target}`,
    });

    eventBus.grantPutEventsTo(terraWebhookRequestHandlerFn);

    const terraAuthrule = new eventbridge.Rule(this, 'TerraAuth', {
      eventBus,
      description: 'Terra Auth',
      eventPattern: {
        source: [`WearablesApi-${props.target}`],
        detailType: ['TerraWebhook'],
        detail: {
          type: ['auth'],
        },
      },
    });

    const terraAuthLogGroup = new LogGroup(this, 'TerraAuthEventLogGroup', {
      logGroupName: `/aws/events/WearablesApi-${props.target}-terra-auth`,
    });

    terraAuthrule.addTarget(
      new eventbridgeTargets.CloudWatchLogGroup(terraAuthLogGroup)
    );

    terraAuthrule.addTarget(new eventbridgeTargets.LambdaFunction(terraAuthFn));

    const terraDeauthrule = new eventbridge.Rule(this, 'TerraDeauth', {
      eventBus,
      description: 'Terra Deauth',
      eventPattern: {
        source: [`WearablesApi-${props.target}`],
        detailType: ['TerraWebhook'],
        detail: {
          type: ['deauth'],
        },
      },
    });

    const terraDeauthLogGroup = new LogGroup(this, 'TerraDeauthEventLogGroup', {
      logGroupName: `/aws/events/WearablesApi-${props.target}-terra-deauth`,
    });

    terraDeauthrule.addTarget(
      new eventbridgeTargets.CloudWatchLogGroup(terraDeauthLogGroup)
    );

    terraDeauthrule.addTarget(
      new eventbridgeTargets.LambdaFunction(terraDeauthFn)
    );
    // end eventbridge

    // api gateway
    const oauthAuthorizer = new HttpLambdaAuthorizer(
      'OauthAuthorizer',
      oauthAuthorizerFn,
      {
        responseTypes: [HttpLambdaResponseType.SIMPLE],
        resultsCacheTtl: Duration.seconds(0),
      }
    );

    const api = new apigwv2.HttpApi(this, `WearablesApi-${props.target}`, {
      corsPreflight: {
        allowOrigins: ['https://*'],
        allowCredentials: true,
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        maxAge: Duration.minutes(10),
      },
      createDefaultStage: true,
      defaultDomainMapping: {
        domainName,
      },
      defaultAuthorizer: oauthAuthorizer,
    });

    const connectWidgetSessionIntegration = new HttpLambdaIntegration(
      'ConnectWidgetSessionIntegration',
      connectWidgetSessionFn
    );

    api.addRoutes({
      integration: connectWidgetSessionIntegration,
      methods: [apigwv2.HttpMethod.POST],
      path: '/api/v1/connect/widget-session',
    });

    const terraWebhookIntegration = new HttpLambdaIntegration(
      'TerraWebhookIntegration',
      terraWebhookRequestHandlerFn
    );

    api.addRoutes({
      integration: terraWebhookIntegration,
      methods: [apigwv2.HttpMethod.POST],
      path: '/webhooks/terra',
      authorizer: new apigwv2.HttpNoneAuthorizer(),
    });

    const connectionsIntegration = new HttpLambdaIntegration(
      'ConnectionsIntegration',
      connectionsFn
    );

    api.addRoutes({
      integration: connectionsIntegration,
      methods: [apigwv2.HttpMethod.GET],
      path: '/api/v1/connections',
    });
    // end api gateway
  }
}
