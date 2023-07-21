import * as cdk from 'aws-cdk-lib';
import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

interface WearablesStackProps extends StackProps {
  readonly target: 'production' | 'staging';
}

export class WearablesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: WearablesStackProps) {
    super(scope, id, props);
  }
}
