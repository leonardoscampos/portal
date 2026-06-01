---
title: "Guia: Terraform do Zero a Multi-ambiente"
description: "Estruture projetos Terraform para múltiplos ambientes de forma escalável — com state remoto, módulos reutilizáveis e promoção controlada entre dev, staging e produção."
---

# Terraform do Zero a Multi-ambiente

Gerenciar Terraform para um único ambiente é simples. O desafio real aparece quando você precisa replicar a mesma infraestrutura em `dev`, `staging` e `prod`, mantendo isolamento de state, controle de variáveis e um workflow confiável de promoção.

Este guia cobre a estrutura de diretórios recomendada, state remoto no S3, módulos reutilizáveis e um fluxo de promoção entre ambientes.

---

## 1. Por Que Multi-ambiente É Difícil

Sem estrutura adequada, projetos crescem para:

- **State compartilhado** → uma mudança em dev afeta prod por acidente
- **Variáveis hardcoded** → `instance_type = "t3.micro"` espalhado em dezenas de arquivos
- **Copy-paste de código** → mesma configuração duplicada por ambiente
- **Sem rastreabilidade** → impossível saber "o que está em prod hoje?"

---

## 2. Estrutura de Diretórios — A Abordagem Recomendada

Existem duas abordagens principais: **diretórios por ambiente** e **workspaces Terraform**.

!!! tip "Recomendação"
    Use **diretórios por ambiente** para isolamento completo de state e configurações independentes. Use workspaces apenas para ambientes muito simples com estado idêntico.

### Estrutura com Diretórios

```
infrastructure/
├── modules/                    # módulos reutilizáveis
│   ├── networking/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── compute/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── database/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── terraform.tfvars     # valores específicos de dev
│   │   └── backend.tf           # state remoto de dev
│   ├── staging/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── terraform.tfvars
│   │   └── backend.tf
│   └── prod/
│       ├── main.tf
│       ├── variables.tf
│       ├── terraform.tfvars
│       └── backend.tf
└── _shared/
    └── data.tf                  # data sources compartilhados
```

---

## 3. State Remoto no S3

O state local é um risco — é fácil de perder, não suporta trabalho em equipe e não tem histórico. Use S3 + DynamoDB para locking.

### Criar os Recursos de Backend

```hcl
# bootstrap/main.tf — rode uma única vez, manualmente
resource "aws_s3_bucket" "terraform_state" {
  bucket = "minha-empresa-terraform-state"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "minha-empresa-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

### Backend por Ambiente

**`environments/dev/backend.tf`**

```hcl
terraform {
  backend "s3" {
    bucket         = "minha-empresa-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "minha-empresa-terraform-locks"
  }
}
```

**`environments/prod/backend.tf`**

```hcl
terraform {
  backend "s3" {
    bucket         = "minha-empresa-terraform-state"
    key            = "prod/terraform.tfstate"    # key diferente!
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "minha-empresa-terraform-locks"
  }
}
```

> A chave `key` diferente garante que cada ambiente tenha seu próprio arquivo de state, completamente isolado.

---

## 4. Módulos Reutilizáveis

Um módulo encapsula um conjunto de recursos relacionados. O ambiente o chama com as variáveis específicas daquele contexto.

**`modules/compute/variables.tf`**

```hcl
variable "environment" {
  description = "Nome do ambiente (dev, staging, prod)"
  type        = string
}

variable "instance_type" {
  description = "Tipo da instância EC2"
  type        = string
  default     = "t3.micro"
}

variable "min_size" {
  description = "Número mínimo de instâncias no ASG"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Número máximo de instâncias no ASG"
  type        = number
}

variable "subnet_ids" {
  description = "IDs das subnets onde as instâncias serão lançadas"
  type        = list(string)
}
```

**`modules/compute/main.tf`**

```hcl
resource "aws_launch_template" "app" {
  name_prefix   = "${var.environment}-app-"
  image_id      = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type

  metadata_options {
    http_tokens = "required"   # IMDSv2 obrigatório
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name        = "${var.environment}-app"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

resource "aws_autoscaling_group" "app" {
  name                = "${var.environment}-app-asg"
  min_size            = var.min_size
  max_size            = var.max_size
  desired_capacity    = var.min_size
  vpc_zone_identifier = var.subnet_ids

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }
}
```

**`modules/compute/outputs.tf`**

```hcl
output "asg_name" {
  description = "Nome do Auto Scaling Group"
  value       = aws_autoscaling_group.app.name
}

output "launch_template_id" {
  description = "ID do Launch Template"
  value       = aws_launch_template.app.id
}
```

---

## 5. Configuração por Ambiente

**`environments/dev/terraform.tfvars`**

```hcl
environment   = "dev"
region        = "us-east-1"

# Compute — menor, mais barato
instance_type = "t3.micro"
min_size      = 1
max_size      = 2

# Banco de dados — menor, sem Multi-AZ
db_instance_class     = "db.t3.micro"
db_multi_az           = false
db_deletion_protection = false
```

**`environments/prod/terraform.tfvars`**

```hcl
environment   = "prod"
region        = "us-east-1"

# Compute — dimensionado para carga real
instance_type = "c5.xlarge"
min_size      = 3
max_size      = 20

# Banco de dados — Multi-AZ, com proteção
db_instance_class      = "db.r6g.large"
db_multi_az            = true
db_deletion_protection = true
```

**`environments/dev/main.tf`**

```hcl
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "terraform"
      Project     = "meu-projeto"
    }
  }
}

module "networking" {
  source = "../../modules/networking"

  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
  az_count     = 2
}

module "compute" {
  source = "../../modules/compute"

  environment   = var.environment
  instance_type = var.instance_type
  min_size      = var.min_size
  max_size      = var.max_size
  subnet_ids    = module.networking.private_subnet_ids
}
```

---

## 6. Workflow de Promoção entre Ambientes

O fluxo de promoção garante que o que vai para prod foi testado em dev e staging.

```
dev  →  staging  →  prod
```

### Passo a passo

```bash
# 1. Aplicar em dev
cd environments/dev
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan

# 2. Validar em dev (smoke tests, testes de integração)
# ...

# 3. Aplicar em staging com os MESMOS valores (exceto tfvars específicos)
cd ../staging
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan

# 4. Validar em staging (testes de carga, QA)
# ...

# 5. Aplicar em prod — com aprovação manual no CI/CD
cd ../prod
terraform init
terraform plan -out=plan.tfplan
# revisar o plan ANTES de aplicar
terraform apply plan.tfplan
```

### Automatizar com GitHub Actions

```yaml
# .github/workflows/terraform.yml
name: Terraform

on:
  push:
    branches: [main]
  pull_request:
    paths: ["infrastructure/**"]

jobs:
  plan:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment: [dev, staging, prod]
    steps:
      - uses: actions/checkout@v4

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.7.5"

      - name: Terraform Init
        run: terraform init
        working-directory: infrastructure/environments/${{ matrix.environment }}
        env:
          AWS_ACCESS_KEY_ID:     ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      - name: Terraform Plan
        run: terraform plan -no-color
        working-directory: infrastructure/environments/${{ matrix.environment }}

  apply-dev:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: dev          # environment protection rules no GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init && terraform apply -auto-approve
        working-directory: infrastructure/environments/dev

  apply-prod:
    needs: apply-dev
    runs-on: ubuntu-latest
    environment: prod         # requer aprovação manual no GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init && terraform apply -auto-approve
        working-directory: infrastructure/environments/prod
```

---

## 7. Boas Práticas

| Prática | Por quê |
|---|---|
| State remoto com locking | Evita corrupção em trabalho paralelo |
| `prevent_destroy = true` em recursos críticos | Evita deleção acidental |
| `default_tags` no provider | Tags consistentes sem repetição |
| Versão do Terraform e providers fixadas | Builds reproduzíveis |
| `terraform plan` antes de qualquer `apply` | Nenhuma surpresa em prod |
| Módulos com `outputs.tf` bem definidos | Reusabilidade e composição |
| Secrets via AWS Secrets Manager / SSM | Nunca no `.tfvars` ou state |
| `terraform.lock.hcl` versionado | Providers idênticos em todas as máquinas |

---

## 8. Comandos de Referência

```bash
# Inicializar (sempre antes de qualquer operação)
terraform init

# Validar sintaxe e configuração
terraform validate

# Ver o que vai mudar
terraform plan

# Salvar o plan em arquivo (recomendado em CI/CD)
terraform plan -out=plan.tfplan

# Aplicar o plan salvo
terraform apply plan.tfplan

# Destruir infra de um ambiente (cuidado!)
terraform destroy

# Listar recursos no state
terraform state list

# Ver detalhes de um recurso no state
terraform state show aws_instance.app

# Importar recurso existente para o state
terraform import aws_instance.app i-1234567890abcdef0

# Formatar arquivos .tf
terraform fmt -recursive

# Atualizar versões de providers no lock file
terraform providers lock
```

---

## Próximos Passos

- [Terraform — Referência Completa](../domains/iac/terraform.md)
- [GitOps — Infraestrutura via Pull Request](../domains/iac/gitops.md)
- [Pulumi — IaC com Linguagens de Programação](../domains/iac/pulumi.md)
- [CloudFormation — IaC Nativo AWS](../domains/iac/cloudformation.md)
