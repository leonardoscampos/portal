---
title: Terraform
description: Terraform HCL, providers, modules, remote state, workspaces and Terraform Cloud reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / terraform</span>
    <h1 class="dph-title">Terraform</h1>
    <p class="dph-desc">The de-facto multi-cloud IaC standard. Declarative HCL, a rich provider ecosystem and a mature module registry make Terraform the first choice for provisioning cloud infrastructure at any scale.</p>
    <div class="dph-badges">
      <span class="tech-badge">HCL</span>
      <span class="tech-badge">Providers</span>
      <span class="tech-badge">Modules</span>
      <span class="tech-badge">Remote State</span>
      <span class="tech-badge">Workspaces</span>
      <span class="tech-badge">Terraform Cloud</span>
    </div>
  </div>
</div>

[← IaC Overview](index.md) | [Ansible →](ansible.md)

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Provider** | Plugin that maps HCL resources to API calls (AWS, Azure, GCP, OCI, Kubernetes…) |
| **Resource** | Declarative unit of infrastructure (`aws_instance`, `azurerm_kubernetes_cluster`…) |
| **Data source** | Read-only reference to existing infrastructure |
| **Variable** | Input parameter — type-checked, validated, optional defaults |
| **Output** | Exported value consumed by other modules or CLI |
| **Module** | Reusable group of resources with inputs/outputs |
| **State** | JSON snapshot of real-world resource IDs and attributes |
| **Plan / Apply** | Two-phase workflow: diff first, mutate second |

---

## Provider & Version Pinning

```hcl
# versions.tf
terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.29"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "terraform"
      Project     = var.project
    }
  }
}
```

---

## Remote State Backends

=== "S3 (AWS)"

    ```hcl
    terraform {
      backend "s3" {
        bucket         = "my-tfstate-prod"
        key            = "networking/terraform.tfstate"
        region         = "us-east-1"
        encrypt        = true
        kms_key_id     = "alias/terraform-state"
        dynamodb_table = "terraform-state-locks"
      }
    }
    ```

    Bootstrap the S3 bucket and DynamoDB lock table:

    ```bash
    aws s3api create-bucket \
      --bucket my-tfstate-prod \
      --region us-east-1

    aws s3api put-bucket-versioning \
      --bucket my-tfstate-prod \
      --versioning-configuration Status=Enabled

    aws s3api put-bucket-encryption \
      --bucket my-tfstate-prod \
      --server-side-encryption-configuration \
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'

    aws dynamodb create-table \
      --table-name terraform-state-locks \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST
    ```

=== "GCS (GCP)"

    ```hcl
    terraform {
      backend "gcs" {
        bucket = "my-tfstate-prod"
        prefix = "networking"
      }
    }
    ```

=== "Azure Blob"

    ```hcl
    terraform {
      backend "azurerm" {
        resource_group_name  = "rg-terraform-state"
        storage_account_name = "stterraformstate"
        container_name       = "tfstate"
        key                  = "networking.terraform.tfstate"
      }
    }
    ```

=== "OCI Object Storage"

    ```hcl
    terraform {
      backend "s3" {
        bucket                      = "my-tfstate-prod"
        key                         = "networking/terraform.tfstate"
        region                      = "us-ashburn-1"
        endpoint                    = "https://<namespace>.compat.objectstorage.us-ashburn-1.oraclecloud.com"
        skip_region_validation      = true
        skip_credentials_validation = true
        skip_metadata_api_check     = true
        force_path_style            = true
      }
    }
    ```

---

## Module Patterns

### Flat Module Structure

```
infra/
├── main.tf
├── variables.tf
├── outputs.tf
├── versions.tf
└── modules/
    ├── networking/
    │   ├── main.tf
    │   ├── variables.tf
    │   └── outputs.tf
    └── eks/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

### Calling a Local Module

```hcl
module "networking" {
  source = "./modules/networking"

  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnet_cidrs = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnet_cidrs  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  environment          = var.environment
}

module "eks" {
  source = "./modules/eks"

  cluster_name    = "prod-eks"
  vpc_id          = module.networking.vpc_id
  subnet_ids      = module.networking.private_subnet_ids
  environment     = var.environment
}
```

### Registry Module (Terraform Registry)

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "prod-eks"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      instance_types = ["m6i.large"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3
    }
  }
}
```

---

## Variables & Validation

```hcl
variable "environment" {
  type        = string
  description = "Deployment environment (dev, staging, prod)."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "allowed_cidrs" {
  type    = list(string)
  default = []

  validation {
    condition     = alltrue([for c in var.allowed_cidrs : can(cidrhost(c, 0))])
    error_message = "All entries in allowed_cidrs must be valid CIDR blocks."
  }
}
```

---

## Workspaces

Workspaces let you maintain separate state files within a single configuration — useful for per-environment isolation without duplicating code.

```bash
terraform workspace new staging
terraform workspace new prod
terraform workspace select prod
terraform workspace list
```

```hcl
locals {
  env_config = {
    dev = {
      instance_type = "t3.small"
      min_size      = 1
    }
    staging = {
      instance_type = "t3.medium"
      min_size      = 2
    }
    prod = {
      instance_type = "m6i.large"
      min_size      = 3
    }
  }
  config = local.env_config[terraform.workspace]
}
```

!!! tip "Prefer separate backends over workspaces for prod"
    Workspaces share the same backend bucket. For strict prod isolation, use separate state paths or separate backend configurations per environment.

---

## State Operations

```bash
# List all resources in state
terraform state list

# Show details of a specific resource
terraform state show aws_eks_cluster.main

# Import an existing resource into state
terraform import aws_s3_bucket.legacy my-existing-bucket-name

# Move a resource to a new address (after refactor)
terraform state mv aws_instance.web module.web.aws_instance.main

# Remove a resource from state without destroying it
terraform state rm aws_s3_bucket.temp

# Pull remote state locally
terraform state pull > backup.tfstate
```

---

## Dynamic Blocks

```hcl
resource "aws_security_group" "app" {
  name   = "app-sg"
  vpc_id = var.vpc_id

  dynamic "ingress" {
    for_each = var.ingress_rules
    content {
      from_port   = ingress.value.from_port
      to_port     = ingress.value.to_port
      protocol    = ingress.value.protocol
      cidr_blocks = ingress.value.cidr_blocks
      description = ingress.value.description
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```

---

## Terraform Cloud / HCP Terraform

```hcl
terraform {
  cloud {
    organization = "my-org"

    workspaces {
      name = "prod-networking"
    }
  }
}
```

| Feature | Description |
|---------|-------------|
| **Remote execution** | Plans and applies run in managed workers — no local credentials |
| **State storage** | Encrypted remote state with history and locking |
| **VCS integration** | Auto-plan on PR, auto-apply on merge |
| **Sentinel policies** | Policy-as-code to enforce governance rules |
| **Cost estimation** | Estimated monthly cost shown in plan output |
| **Private registry** | Host internal modules and providers |

---

## GitHub Actions CI/CD

```yaml
name: Terraform

on:
  pull_request:
    paths: ["infra/**"]
  push:
    branches: [main]
    paths: ["infra/**"]

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  terraform:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra/

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.8.0"

      - name: Init
        run: terraform init

      - name: Format check
        run: terraform fmt -check -recursive

      - name: Validate
        run: terraform validate

      - name: Plan
        id: plan
        run: terraform plan -out=tfplan -no-color

      - name: Apply
        if: github.ref == 'refs/heads/main'
        run: terraform apply -auto-approve tfplan
```

---

## Best Practices

| Practice | Why |
|----------|-----|
| **Pin provider versions** with `~>` | Avoid unexpected breaking changes |
| **Use `terraform fmt` in CI** | Enforce consistent formatting |
| **Store state remotely with locking** | Prevent concurrent-apply corruption |
| **Never commit `terraform.tfvars` with secrets** | Use environment variables or Vault |
| **Use `moved` blocks instead of `state mv`** | Refactors are tracked in code history |
| **Separate modules from root** | Easier testing and reuse |
| **Tag all resources via `default_tags`** | Cost attribution and compliance |
| **Run `terraform validate` in CI** | Catch syntax errors before plan |
