---
title: "Guide: Terraform from Zero to Multi-environment"
description: "Structure Terraform projects for multiple environments in a scalable way — with remote state, reusable modules and controlled promotion between dev, staging and production."
---

# Terraform from Zero to Multi-environment

Managing Terraform for a single environment is straightforward. The real challenge comes when you need to replicate the same infrastructure across `dev`, `staging` and `prod`, maintaining state isolation, variable control and a reliable promotion workflow.

This guide covers the recommended directory structure, remote state on S3, reusable modules and an environment promotion workflow.

---

## 1. Why Multi-environment Is Hard

Without proper structure, projects grow into:

- **Shared state** → a change in dev accidentally affects prod
- **Hardcoded variables** → `instance_type = "t3.micro"` scattered across dozens of files
- **Copy-paste code** → same configuration duplicated per environment
- **No traceability** → impossible to know "what's in prod today?"

---

## 2. Directory Structure — The Recommended Approach

There are two main approaches: **per-environment directories** and **Terraform workspaces**.

!!! tip "Recommendation"
    Use **per-environment directories** for complete state isolation and independent configurations. Use workspaces only for very simple environments with identical state.

### Directory-based Structure

```
infrastructure/
├── modules/                    # reusable modules
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
│   │   ├── terraform.tfvars     # dev-specific values
│   │   └── backend.tf           # dev remote state
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
    └── data.tf                  # shared data sources
```

---

## 3. Remote State on S3

Local state is a risk — easy to lose, doesn't support teamwork and has no history. Use S3 + DynamoDB for locking.

### Create Backend Resources

```hcl
# bootstrap/main.tf — run once, manually
resource "aws_s3_bucket" "terraform_state" {
  bucket = "my-company-terraform-state"

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
  name         = "my-company-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}
```

### Backend per Environment

**`environments/dev/backend.tf`**

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "my-company-terraform-locks"
  }
}
```

**`environments/prod/backend.tf`**

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "prod/terraform.tfstate"    # different key!
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "my-company-terraform-locks"
  }
}
```

> The different `key` value ensures each environment has its own state file, completely isolated.

---

## 4. Reusable Modules

A module encapsulates a set of related resources. The environment calls it with the specific variables for that context.

**`modules/compute/variables.tf`**

```hcl
variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "min_size" {
  description = "Minimum number of instances in the ASG"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Maximum number of instances in the ASG"
  type        = number
}

variable "subnet_ids" {
  description = "IDs of subnets where instances will be launched"
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
    http_tokens = "required"   # IMDSv2 required
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
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.app.name
}

output "launch_template_id" {
  description = "Launch Template ID"
  value       = aws_launch_template.app.id
}
```

---

## 5. Per-environment Configuration

**`environments/dev/terraform.tfvars`**

```hcl
environment   = "dev"
region        = "us-east-1"

# Compute — smaller, cheaper
instance_type = "t3.micro"
min_size      = 1
max_size      = 2

# Database — smaller, no Multi-AZ
db_instance_class      = "db.t3.micro"
db_multi_az            = false
db_deletion_protection = false
```

**`environments/prod/terraform.tfvars`**

```hcl
environment   = "prod"
region        = "us-east-1"

# Compute — sized for real load
instance_type = "c5.xlarge"
min_size      = 3
max_size      = 20

# Database — Multi-AZ, with deletion protection
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
      Project     = "my-project"
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

## 6. Promotion Workflow Between Environments

The promotion flow ensures that what goes to prod was tested in dev and staging.

```
dev  →  staging  →  prod
```

### Step by step

```bash
# 1. Apply to dev
cd environments/dev
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan

# 2. Validate in dev (smoke tests, integration tests)
# ...

# 3. Apply to staging with the SAME values (except environment-specific tfvars)
cd ../staging
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan

# 4. Validate in staging (load tests, QA)
# ...

# 5. Apply to prod — with manual approval in CI/CD
cd ../prod
terraform init
terraform plan -out=plan.tfplan
# review the plan BEFORE applying
terraform apply plan.tfplan
```

### Automate with GitHub Actions

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
    environment: dev          # GitHub environment protection rules
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init && terraform apply -auto-approve
        working-directory: infrastructure/environments/dev

  apply-prod:
    needs: apply-dev
    runs-on: ubuntu-latest
    environment: prod         # requires manual approval in GitHub
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init && terraform apply -auto-approve
        working-directory: infrastructure/environments/prod
```

---

## 7. Best Practices

| Practice | Why |
|---|---|
| Remote state with locking | Prevents corruption from parallel work |
| `prevent_destroy = true` on critical resources | Prevents accidental deletion |
| `default_tags` on the provider | Consistent tags without repetition |
| Fixed Terraform and provider versions | Reproducible builds |
| `terraform plan` before every `apply` | No surprises in prod |
| Modules with well-defined `outputs.tf` | Reusability and composition |
| Secrets via AWS Secrets Manager / SSM | Never in `.tfvars` or state |
| `terraform.lock.hcl` committed to VCS | Identical providers across all machines |

---

## 8. Quick Reference

```bash
# Initialise (always before any operation)
terraform init

# Validate syntax and configuration
terraform validate

# Preview what will change
terraform plan

# Save plan to file (recommended in CI/CD)
terraform plan -out=plan.tfplan

# Apply a saved plan
terraform apply plan.tfplan

# Destroy environment infrastructure (be careful!)
terraform destroy

# List resources in state
terraform state list

# Inspect a specific resource in state
terraform state show aws_instance.app

# Import existing resource into state
terraform import aws_instance.app i-1234567890abcdef0

# Format .tf files
terraform fmt -recursive

# Update provider versions in lock file
terraform providers lock
```

---

## Next Steps

- [Terraform — Full Reference](../domains/iac/terraform.md)
- [GitOps — Infrastructure via Pull Request](../domains/iac/gitops.md)
- [Pulumi — IaC with Programming Languages](../domains/iac/pulumi.md)
- [CloudFormation — Native AWS IaC](../domains/iac/cloudformation.md)
