---
date: 2026-05-20
authors:
  - leonardoscampos
categories:
  - IaC
tags:
  - terraform
  - aws
  - multi-cloud
  - best-practices
---

# Terraform at Scale: Production Lessons

After managing Terraform infrastructure across multiple teams and cloud providers, I've learned that most problems don't come from HCL code — they come from **organisation**. In this post, I share the patterns that have worked in production.

<!-- more -->

## The "everything in one repository" problem

Most teams start with a single repository and a single `terraform/` folder. This works fine until the moment when:

- `terraform plan` takes 10+ minutes due to a monolithic state file
- One change error brings down the entire infrastructure
- Different teams need independent release cycles

The solution is to **separate workspaces by layer and by team**.

## Recommended repository structure

```
infra-core/          # Networking, IAM, DNS — platform team
infra-data/          # RDS, S3, Glue — data team
infra-app/           # EKS, ALB, ECR — product team
```

Each repository has its own remote state, its own variables and its own CI/CD cycle. They communicate via **data sources**:

```hcl
# infra-app reading outputs from infra-core
data "terraform_remote_state" "core" {
  backend = "s3"
  config = {
    bucket = "my-tfstate"
    key    = "core/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_eks_cluster" "main" {
  vpc_config {
    subnet_ids = data.terraform_remote_state.core.outputs.private_subnet_ids
  }
}
```

## Remote State: S3 + DynamoDB with versioning

Never use remote state without a lock. The minimum safe configuration:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-tfstate"
    key            = "app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
```

!!! tip "Version the state bucket"
    Enable versioning on S3 and retention policies. I've had to restore a corrupted state file before — without versioning, it would have been catastrophic.

## Modules: don't reinvent what already exists

Before writing a module from scratch, check the [Terraform Registry](https://registry.terraform.io). Community modules (`terraform-aws-modules`) are widely tested and maintained.

When creating your own modules, follow these rules:

| Rule | Reason |
|---|---|
| One module = one responsibility | Easier to test and reuse |
| Expose only what's needed as output | Avoids implicit dependencies |
| Version with Git tags | Guarantees reproducibility |
| Include `README.md` with examples | Documentation is part of the product |

## CI/CD: automated plan, manual apply in production

The workflow that works in practice:

1. **PR opened** → automatic `terraform plan` with output in the PR
2. **PR approved** → merge to `main`
3. **Staging deploy** → automatic `terraform apply`
4. **Production deploy** → `terraform apply` with manual approval in the pipeline

```yaml
# GitHub Actions — plan on PR
- name: Terraform Plan
  run: |
    terraform init
    terraform plan -out=tfplan -no-color 2>&1 | tee plan.txt

- name: Comment on PR
  uses: actions/github-script@v7
  with:
    script: |
      const plan = require('fs').readFileSync('plan.txt', 'utf8')
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        body: `\`\`\`hcl\n${plan}\n\`\`\``
      })
```

## Conclusion

Terraform at scale is a software engineering problem, not an HCL syntax problem. Invest in:

- A **clear repository structure** from the start
- **Secure remote state** with locking and versioning
- **Versioned modules** instead of copy-paste
- **CI/CD** that automates the plan but requires approval for apply in production

These patterns have saved hours of incidents and made onboarding new team members much faster.
