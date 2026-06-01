---
title: CloudFormation
description: AWS CloudFormation templates, stacks, StackSets, CDK and custom resources reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / cloudformation</span>
    <h1 class="dph-title">CloudFormation</h1>
    <p class="dph-desc">AWS-native declarative IaC. CloudFormation templates describe AWS resources and their dependencies; the service handles provisioning, updates and rollback automatically. CDK adds a higher-level abstraction using real programming languages that compiles down to CloudFormation.</p>
    <div class="dph-badges">
      <span class="tech-badge">Templates</span>
      <span class="tech-badge">Stacks</span>
      <span class="tech-badge">StackSets</span>
      <span class="tech-badge">CDK</span>
      <span class="tech-badge">Change Sets</span>
      <span class="tech-badge">Custom Resources</span>
    </div>
  </div>
</div>

[← Ansible](ansible.md) | [← IaC Overview](index.md) | [Pulumi →](pulumi.md)

---

## Template Structure

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: "ECS Service with ALB"

Parameters:
  Environment:
    Type: String
    AllowedValues: [dev, staging, prod]
    Default: dev
  ImageUri:
    Type: String
    Description: "ECR image URI for the service"

Mappings:
  EnvConfig:
    dev:
      DesiredCount: 1
      Cpu: "256"
      Memory: "512"
    prod:
      DesiredCount: 3
      Cpu: "1024"
      Memory: "2048"

Conditions:
  IsProd: !Equals [!Ref Environment, prod]

Resources:
  ECSTaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: !Sub "${Environment}-app"
      Cpu: !FindInMap [EnvConfig, !Ref Environment, Cpu]
      Memory: !FindInMap [EnvConfig, !Ref Environment, Memory]
      NetworkMode: awsvpc
      RequiresCompatibilities: [FARGATE]
      ExecutionRoleArn: !GetAtt ECSExecutionRole.Arn
      ContainerDefinitions:
        - Name: app
          Image: !Ref ImageUri
          Essential: true
          PortMappings:
            - ContainerPort: 8080
          LogConfiguration:
            LogDriver: awslogs
            Options:
              awslogs-group: !Ref LogGroup
              awslogs-region: !Ref AWS::Region
              awslogs-stream-prefix: app

  LogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      RetentionInDays: !If [IsProd, 90, 14]

Outputs:
  ServiceUrl:
    Description: "Load balancer DNS name"
    Value: !GetAtt ALB.DNSName
    Export:
      Name: !Sub "${AWS::StackName}-ServiceUrl"
```

---

## Intrinsic Functions

| Function | Use Case |
|----------|----------|
| `!Ref` | Reference a parameter or resource's primary ID |
| `!GetAtt Resource.Attr` | Get a specific attribute of a resource |
| `!Sub "string ${Var}"` | String interpolation |
| `!Join [delim, [list]]` | Concatenate a list with a delimiter |
| `!Select [idx, list]` | Pick an element from a list |
| `!Split [delim, str]` | Split a string into a list |
| `!FindInMap [Map, Key1, Key2]` | Look up a value in a Mappings section |
| `!If [Cond, True, False]` | Conditional value selection |
| `!Equals [A, B]` | Produces a Condition boolean |
| `!And / !Or / !Not` | Compound condition logic |
| `!ImportValue ExportName` | Consume a value exported by another stack |

---

## Change Sets

Change sets give you a preview of what will be modified before applying:

```bash
# Create a change set
aws cloudformation create-change-set \
  --stack-name prod-ecs \
  --change-set-name update-image-v2 \
  --template-body file://template.yaml \
  --parameters ParameterKey=ImageUri,ParameterValue=123456789012.dkr.ecr.us-east-1.amazonaws.com/app:v2 \
  --capabilities CAPABILITY_IAM

# Review it
aws cloudformation describe-change-set \
  --stack-name prod-ecs \
  --change-set-name update-image-v2

# Execute
aws cloudformation execute-change-set \
  --stack-name prod-ecs \
  --change-set-name update-image-v2
```

---

## StackSets — Multi-Account / Multi-Region

StackSets deploy a single template across multiple AWS accounts and/or regions from a management account.

```yaml
# stackset.yaml — deploy a GuardDuty baseline to all accounts
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  GuardDutyDetector:
    Type: AWS::GuardDuty::Detector
    Properties:
      Enable: true
      FindingPublishingFrequency: SIX_HOURS
      DataSources:
        S3Logs:
          Enable: true
        Kubernetes:
          AuditLogs:
            Enable: true
```

```bash
aws cloudformation create-stack-set \
  --stack-set-name guardduty-baseline \
  --template-body file://stackset.yaml \
  --capabilities CAPABILITY_IAM \
  --permission-model SERVICE_MANAGED \
  --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false

aws cloudformation create-stack-instances \
  --stack-set-name guardduty-baseline \
  --deployment-targets OrganizationalUnitIds=["ou-xxxx-yyyyyyyy"] \
  --regions us-east-1 eu-west-1 ap-southeast-1
```

---

## Custom Resources

Custom resources let you invoke Lambda to manage anything not natively supported.

```yaml
Resources:
  InitDatabaseFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: cfn-init-db
      Runtime: python3.12
      Handler: index.handler
      Role: !GetAtt LambdaRole.Arn
      Code:
        ZipFile: |
          import cfnresponse, boto3

          def handler(event, context):
              try:
                  if event['RequestType'] in ['Create', 'Update']:
                      # Run DB migrations here
                      pass
                  cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
              except Exception as e:
                  cfnresponse.send(event, context, cfnresponse.FAILED, {'Error': str(e)})

  DatabaseInit:
    Type: Custom::DatabaseInit
    DependsOn: RDSInstance
    Properties:
      ServiceToken: !GetAtt InitDatabaseFunction.Arn
      DBEndpoint: !GetAtt RDSInstance.Endpoint.Address
```

---

## AWS CDK

CDK (Cloud Development Kit) lets you write infrastructure in TypeScript, Python, Java or Go — compiled to CloudFormation at synth time.

=== "TypeScript"

    ```typescript
    // lib/eks-stack.ts
    import * as cdk from 'aws-cdk-lib';
    import * as eks from 'aws-cdk-lib/aws-eks';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import { Construct } from 'constructs';

    export class EksStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, 'VPC', {
          maxAzs: 3,
          natGateways: 1,
        });

        const cluster = new eks.Cluster(this, 'EKS', {
          vpc,
          version: eks.KubernetesVersion.V1_30,
          defaultCapacity: 0,
        });

        cluster.addNodegroupCapacity('General', {
          instanceTypes: [new ec2.InstanceType('m6i.large')],
          minSize: 2,
          maxSize: 10,
          desiredSize: 3,
        });
      }
    }
    ```

=== "Python"

    ```python
    # stacks/eks_stack.py
    from aws_cdk import Stack
    import aws_cdk.aws_eks as eks
    import aws_cdk.aws_ec2 as ec2
    from constructs import Construct

    class EksStack(Stack):
        def __init__(self, scope: Construct, id: str, **kwargs):
            super().__init__(scope, id, **kwargs)

            vpc = ec2.Vpc(self, "VPC", max_azs=3, nat_gateways=1)

            cluster = eks.Cluster(
                self, "EKS",
                vpc=vpc,
                version=eks.KubernetesVersion.V1_30,
                default_capacity=0,
            )

            cluster.add_nodegroup_capacity(
                "General",
                instance_types=[ec2.InstanceType("m6i.large")],
                min_size=2,
                max_size=10,
                desired_size=3,
            )
    ```

```bash
# CDK workflow
cdk bootstrap aws://123456789012/us-east-1
cdk synth        # generate CloudFormation template
cdk diff         # show what will change
cdk deploy       # deploy (creates a change set under the hood)
cdk destroy      # tear down the stack
```

---

## Drift Detection

CloudFormation can detect when real-world resources have drifted from their template definition.

```bash
# Start drift detection on a stack
aws cloudformation detect-stack-drift --stack-name prod-ecs

# Check detection status
aws cloudformation describe-stack-drift-detection-status \
  --stack-drift-detection-id <id>

# List drifted resources
aws cloudformation describe-stack-resource-drifts \
  --stack-name prod-ecs \
  --stack-resource-drift-status-filters MODIFIED DELETED
```

---

## Rollback & Stack Policies

```bash
# Disable rollback (debug failed deployments)
aws cloudformation create-stack \
  --stack-name my-stack \
  --template-body file://template.yaml \
  --disable-rollback

# Set a stack policy to protect resources from replacement
aws cloudformation set-stack-policy \
  --stack-name prod-ecs \
  --stack-policy-body '{
    "Statement": [{
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["Update:Replace", "Update:Delete"],
      "Resource": "LogicalResourceId/RDSInstance"
    }]
  }'
```

!!! warning "CDK vs Terraform"
    CDK is an excellent choice if your team is already AWS-only and prefers typed languages. For multi-cloud workloads or teams already invested in HCL, Terraform remains the stronger choice.
