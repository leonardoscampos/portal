---
title: AWS IaC & DevOps
description: Terraform, CDK, CloudFormation, CodePipeline, CodeBuild, ECR — infrastructure automation on AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / iac</span>
    <h1 class="dph-title">IaC &amp; DevOps</h1>
    <p class="dph-desc">Everything-as-code on AWS — from Terraform remote state in S3 to self-mutating CDK Pipelines, automated container builds and GitOps-driven deployments. No manual console clicks in production.</p>
    <div class="dph-badges">
      <span class="tech-badge">Terraform</span>
      <span class="tech-badge">CDK</span>
      <span class="tech-badge">CloudFormation</span>
      <span class="tech-badge">CodePipeline</span>
      <span class="tech-badge">CodeBuild</span>
      <span class="tech-badge">ECR</span>
      <span class="tech-badge">Terragrunt</span>
    </div>
  </div>
</div>

---

## Terraform — AWS Provider

The **Terraform AWS Provider** is the primary IaC tool for AWS in most DevOps teams. It covers 1,000+ resource types, integrates with the Terraform Cloud/Enterprise ecosystem and enables multi-cloud portability.

### Remote state backend

Always use remote state. S3 + DynamoDB is the standard AWS backend — S3 stores the state file, DynamoDB provides distributed locking.

```hcl
# backend.tf
terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  backend "s3" {
    bucket         = "my-project-tfstate"
    key            = "prod/us-east-1/eks/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "alias/terraform-state"
    dynamodb_table = "my-project-tfstate-lock"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.env
      ManagedBy   = "terraform"
    }
  }
}
```

### Bootstrap the backend (once per account/region)

```bash
# Create the state bucket with versioning + encryption
aws s3api create-bucket \
  --bucket my-project-tfstate \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket my-project-tfstate \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket my-project-tfstate \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'

# Create the lock table
aws dynamodb create-table \
  --table-name my-project-tfstate-lock \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH
```

### Community modules

The [`terraform-aws-modules`](https://github.com/terraform-aws-modules) organisation maintains high-quality, battle-tested modules for the most common resources.

| Module | What it builds |
|--------|---------------|
| `terraform-aws-modules/vpc/aws` | VPC + subnets + NAT + endpoints |
| `terraform-aws-modules/eks/aws` | EKS cluster + node groups + IRSA |
| `terraform-aws-modules/rds/aws` | RDS instance / cluster + option groups |
| `terraform-aws-modules/s3-bucket/aws` | S3 with encryption + lifecycle + logging |
| `terraform-aws-modules/iam/aws` | IAM roles, policies, assumable roles |
| `terraform-aws-modules/alb/aws` | ALB/NLB + listeners + target groups |

!!! tip "Pin module versions"
    Always pin to a specific module version (`version = "~> 20.0"` for EKS). Community modules can introduce breaking changes. Review the module's changelog before upgrading — EKS module major versions often require cluster re-creation.

### Workspace strategy

```
├── modules/          # Reusable Terraform modules
│   ├── eks-cluster/
│   ├── rds-postgres/
│   └── s3-backend/
├── live/             # Per-env infrastructure (Terragrunt or plain TF)
│   ├── prod/
│   │   ├── us-east-1/
│   │   │   ├── vpc/
│   │   │   ├── eks/
│   │   │   └── rds/
│   └── staging/
│       └── us-east-1/
└── global/
    └── iam/
```

---

## AWS CDK

The AWS Cloud Development Kit (CDK) defines cloud infrastructure in code using familiar programming languages. CDK synthesizes to CloudFormation templates.

### Construct levels

| Level | Description | Example |
|-------|-------------|---------|
| **L1** (Cfn*) | Direct CloudFormation resource mapping | `CfnBucket`, `CfnSecurityGroup` |
| **L2** | Higher-level with sensible defaults | `s3.Bucket`, `ec2.Vpc`, `eks.Cluster` |
| **L3** (Patterns) | Complete architectural patterns | `ecs_patterns.ApplicationLoadBalancedFargateService` |

```python
from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecs_patterns as ecs_patterns,
)

class ApiStack(Stack):
    def __init__(self, scope, id, **kwargs):
        super().__init__(scope, id, **kwargs)

        vpc = ec2.Vpc(self, "Vpc", max_azs=3)

        cluster = ecs.Cluster(self, "Cluster",
            vpc=vpc,
            container_insights=True
        )

        # L3 pattern: ALB + Fargate + auto-scaling in one construct
        ecs_patterns.ApplicationLoadBalancedFargateService(self, "Api",
            cluster=cluster,
            cpu=512,
            memory_limit_mib=1024,
            desired_count=2,
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(repo, tag="latest"),
                container_port=8080,
            ),
        )
```

### CDK Pipelines (self-mutating)

CDK Pipelines is a construct library that builds a CI/CD pipeline which automatically updates itself when you push changes to the pipeline definition.

```python
from aws_cdk.pipelines import CodePipeline, CodePipelineSource, ShellStep

pipeline = CodePipeline(self, "Pipeline",
    pipeline_name="MyPipeline",
    synth=ShellStep("Synth",
        input=CodePipelineSource.connection("my-org/my-repo", "main",
            connection_arn="arn:aws:codestar-connections:..."
        ),
        commands=["npm ci", "npm run build", "npx cdk synth"],
    )
)

pipeline.add_stage(MyAppStage(self, "Prod",
    env={"account": PROD_ACCOUNT, "region": "us-east-1"}
))
```

---

## CloudFormation

CloudFormation is the native AWS IaC service. CDK synthesizes to CloudFormation; use it directly when you need native AWS integrations (StackSets, Service Catalog, Control Tower customisations).

### Key concepts

| Concept | Description |
|---------|-------------|
| **Stack** | Unit of deployment; maps to a template |
| **Nested Stack** | Child stack referenced from a parent; breaks the 500-resource limit |
| **StackSet** | Deploy the same stack to multiple accounts/regions |
| **Change Set** | Preview changes before executing |
| **Drift Detection** | Detect manual configuration changes outside CloudFormation |
| **Stack Policy** | Protect specific resources from update/deletion |

!!! warning "Resource limits"
    A single CloudFormation stack is limited to 500 resources. For large EKS clusters with many Kubernetes resources, use nested stacks or migrate to CDK (which handles splitting automatically).

---

## CodePipeline + CodeBuild

AWS-native CI/CD for teams that want a fully managed pipeline without operating Jenkins or GitLab runners.

### Pipeline structure

```
Source (GitHub/CodeCommit/S3)
  ↓
Build (CodeBuild — lint, test, docker build, push to ECR)
  ↓
Approval (manual gate for production)
  ↓
Deploy (CodeDeploy / ECS / EKS kubectl / CloudFormation)
```

### buildspec.yml

```yaml
version: 0.2

env:
  variables:
    AWS_DEFAULT_REGION: "us-east-1"
  parameter-store:
    SONAR_TOKEN: /cicd/sonar-token

phases:
  install:
    runtime-versions:
      python: 3.12
    commands:
      - pip install -r requirements-dev.txt

  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REGISTRY
      - IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c1-8)

  build:
    commands:
      - docker build -t $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG .
      - docker build -t $ECR_REGISTRY/$IMAGE_REPO_NAME:latest .

  post_build:
    commands:
      - docker push $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG
      - docker push $ECR_REGISTRY/$IMAGE_REPO_NAME:latest
      - printf '[{"name":"%s","imageUri":"%s"}]' $CONTAINER_NAME $ECR_REGISTRY/$IMAGE_REPO_NAME:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json

cache:
  paths:
    - /root/.cache/pip/**/*
```

---

## ECR — Elastic Container Registry

ECR is the managed Docker/OCI registry for AWS. It integrates natively with ECS, EKS, Lambda (container images), CodeBuild and CodePipeline.

### Lifecycle policies

Always define lifecycle policies to prevent unbounded storage growth. A common pattern: keep the last 30 tagged images and expire all untagged images after 1 day.

```hcl
resource "aws_ecr_repository" "app" {
  name                 = "${var.project}/app"
  image_tag_mutability = "IMMUTABLE"  # prevents overwriting existing tags

  image_scanning_configuration {
    scan_on_push = true  # Inspector v2 enhanced scanning
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.ecr.arn
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 30 tagged releases"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v", "release-"]
          countType     = "imageCountMoreThan"
          countNumber   = 30
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      }
    ]
  })
}
```

### Pull-through cache

ECR Pull-Through Cache transparently caches images from Docker Hub, ECR Public, Quay and GitHub Container Registry in your private ECR registry — reducing external bandwidth, improving reliability and enabling image scanning on cached images.

```hcl
resource "aws_ecr_pull_through_cache_rule" "dockerhub" {
  ecr_repository_prefix = "dockerhub"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub.arn
}
```

!!! tip "IMMUTABLE tags in production"
    Set `image_tag_mutability = "IMMUTABLE"` on production ECR repositories. This prevents accidental overwrites of released image tags (`v1.2.3` should always mean the same image). Use content-addressable SHA digests (`@sha256:...`) in Kubernetes manifests for guaranteed reproducibility.

---

[← AWS Overview](index.md){ .md-button }
