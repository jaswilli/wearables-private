#!/usr/bin/env node

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WearablesStack } from '../lib/wearables-stack';

const AWS_ACCOUNT_ID = '923598817927';
const REGION = 'us-east-1';

const app = new cdk.App();

new WearablesStack(app, 'WearablesStack-staging', {
  env: {
    account: AWS_ACCOUNT_ID,
    region: REGION,
  },
  target: 'staging',
});

new WearablesStack(app, 'WearablesStack-production', {
  env: {
    account: AWS_ACCOUNT_ID,
    region: REGION,
  },
  target: 'production',
  terminationProtection: true,
});
