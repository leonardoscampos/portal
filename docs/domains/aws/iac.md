---
title: AWS IaC & DevOps
description: Terraform, CDK, CloudFormation, CodePipeline, CodeBuild, ECR — automação de infraestrutura na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / iac</span>
    <h1 class="dph-title">IaC &amp; DevOps</h1>
    <p class="dph-desc">Tudo-como-código na AWS — do estado remoto Terraform no S3 a CDK Pipelines auto-mutáveis, builds de contêineres automatizados e deploys orientados por GitOps. Sem cliques manuais no console em produção.</p>
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

O **Terraform AWS Provider** é a principal ferramenta de IaC para AWS na maioria dos times DevOps. Abrange mais de 1.000 tipos de recursos, integra-se ao ecossistema Terraform Cloud/Enterprise e permite portabilidade multi-cloud.

### Backend de estado remoto

Sempre use estado remoto. S3 + DynamoDB é o backend padrão AWS — o S3 armazena o arquivo de estado, o DynamoDB fornece bloqueio distribuído.

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

### Bootstrap do backend (uma vez por conta/região)

```bash
# Criar o bucket de estado com versionamento + criptografia
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

# Criar a tabela de bloqueio
aws dynamodb create-table \
  --table-name my-project-tfstate-lock \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH
```

### Módulos da comunidade

A organização [`terraform-aws-modules`](https://github.com/terraform-aws-modules) mantém módulos de alta qualidade e testados em produção para os recursos mais comuns.

| Módulo | O que constrói |
|--------|----------------|
| `terraform-aws-modules/vpc/aws` | VPC + sub-redes + NAT + endpoints |
| `terraform-aws-modules/eks/aws` | Cluster EKS + node groups + IRSA |
| `terraform-aws-modules/rds/aws` | Instância / cluster RDS + option groups |
| `terraform-aws-modules/s3-bucket/aws` | S3 com criptografia + lifecycle + logging |
| `terraform-aws-modules/iam/aws` | Roles, políticas e assumable roles IAM |
| `terraform-aws-modules/alb/aws` | ALB/NLB + listeners + target groups |

!!! tip "Fixe versões de módulos"
    Sempre fixe em uma versão específica do módulo (`version = "~> 20.0"` para EKS). Módulos da comunidade podem introduzir breaking changes. Revise o changelog do módulo antes de atualizar — versões principais do módulo EKS frequentemente exigem recriação do cluster.

### Estratégia de workspace

```
├── modules/          # Módulos Terraform reutilizáveis
│   ├── eks-cluster/
│   ├── rds-postgres/
│   └── s3-backend/
├── live/             # Infraestrutura por ambiente (Terragrunt ou Terraform puro)
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

O AWS Cloud Development Kit (CDK) define infraestrutura em nuvem como código usando linguagens de programação conhecidas. O CDK sintetiza para templates CloudFormation.

### Níveis de constructs

| Nível | Descrição | Exemplo |
|-------|-----------|---------|
| **L1** (Cfn*) | Mapeamento direto de recurso CloudFormation | `CfnBucket`, `CfnSecurityGroup` |
| **L2** | Alto nível com padrões sensatos | `s3.Bucket`, `ec2.Vpc`, `eks.Cluster` |
| **L3** (Patterns) | Padrões arquiteturais completos | `ecs_patterns.ApplicationLoadBalancedFargateService` |

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

        # Padrão L3: ALB + Fargate + auto-scaling em um único construct
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

### CDK Pipelines (auto-mutável)

O CDK Pipelines é uma biblioteca de constructs que cria um pipeline CI/CD que se atualiza automaticamente quando você envia alterações na definição do pipeline.

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

O CloudFormation é o serviço nativo de IaC da AWS. O CDK sintetiza para CloudFormation; use-o diretamente quando precisar de integrações nativas AWS (StackSets, Service Catalog, personalizações do Control Tower).

### Conceitos principais

| Conceito | Descrição |
|----------|-----------|
| **Stack** | Unidade de implantação; mapeia para um template |
| **Nested Stack** | Stack filho referenciado por um pai; quebra o limite de 500 recursos |
| **StackSet** | Implanta a mesma stack em múltiplas contas/regiões |
| **Change Set** | Visualiza alterações antes de executar |
| **Drift Detection** | Detecta alterações manuais de configuração fora do CloudFormation |
| **Stack Policy** | Protege recursos específicos de atualização/exclusão |

!!! warning "Limites de recursos"
    Uma única stack CloudFormation é limitada a 500 recursos. Para clusters EKS grandes com muitos recursos Kubernetes, use nested stacks ou migre para CDK (que gerencia a divisão automaticamente).

---

## CodePipeline + CodeBuild

CI/CD nativo AWS para times que desejam um pipeline totalmente gerenciado sem operar Jenkins ou runners GitLab.

### Estrutura do pipeline

```
Source (GitHub/CodeCommit/S3)
  ↓
Build (CodeBuild — lint, test, docker build, push para ECR)
  ↓
Approval (gate manual para produção)
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
      - echo Fazendo login no Amazon ECR...
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

O ECR é o registro Docker/OCI gerenciado para AWS. Integra-se nativamente com ECS, EKS, Lambda (imagens de contêiner), CodeBuild e CodePipeline.

### Políticas de ciclo de vida

Sempre defina políticas de ciclo de vida para evitar crescimento ilimitado de armazenamento. Um padrão comum: manter as últimas 30 imagens tagueadas e expirar todas as imagens sem tag após 1 dia.

```hcl
resource "aws_ecr_repository" "app" {
  name                 = "${var.project}/app"
  image_tag_mutability = "IMMUTABLE"  # impede sobrescrever tags existentes

  image_scanning_configuration {
    scan_on_push = true  # escaneamento aprimorado Inspector v2
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
        description  = "Manter últimas 30 releases tagueadas"
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
        description  = "Expirar imagens sem tag após 1 dia"
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

O ECR Pull-Through Cache faz cache transparente de imagens do Docker Hub, ECR Public, Quay e GitHub Container Registry em seu registro ECR privado — reduzindo largura de banda externa, melhorando a confiabilidade e habilitando escaneamento de imagens em imagens em cache.

```hcl
resource "aws_ecr_pull_through_cache_rule" "dockerhub" {
  ecr_repository_prefix = "dockerhub"
  upstream_registry_url = "registry-1.docker.io"
  credential_arn        = aws_secretsmanager_secret.dockerhub.arn
}
```

!!! tip "Tags IMMUTABLE em produção"
    Defina `image_tag_mutability = "IMMUTABLE"` nos repositórios ECR de produção. Isso impede sobrescritas acidentais de tags de imagem lançadas (`v1.2.3` deve sempre significar a mesma imagem). Use digests SHA endereçáveis por conteúdo (`@sha256:...`) em manifestos Kubernetes para reprodutibilidade garantida.

---

[← Visão Geral AWS](index.md){ .md-button }
