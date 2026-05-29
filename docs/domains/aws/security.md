---
title: AWS Security & IAM
description: IAM, Organizations, KMS, Secrets Manager, GuardDuty — AWS security and identity fundamentals.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / security</span>
    <h1 class="dph-title">Security &amp; IAM</h1>
    <p class="dph-desc">Least-privilege identity, envelope encryption, secrets rotation, threat detection and compliance guardrails — the AWS security model from first principles to production-ready multi-account governance.</p>
    <div class="dph-badges">
      <span class="tech-badge">IAM</span>
      <span class="tech-badge">Organizations</span>
      <span class="tech-badge">SCPs</span>
      <span class="tech-badge">KMS</span>
      <span class="tech-badge">Secrets Manager</span>
      <span class="tech-badge">GuardDuty</span>
      <span class="tech-badge">Security Hub</span>
    </div>
  </div>
</div>

---

## IAM — Identity and Access Management

IAM is the access control plane for every AWS service. Every API call is evaluated against the IAM policy engine.

### Identity types

| Type | Description | When to use |
|------|-------------|------------|
| **IAM User** | Long-lived credentials (access key + password) | Break-glass emergency access only; avoid for workloads |
| **IAM Role** | Temporary credentials via STS; assumed by principals | EC2 instance profiles, Lambda functions, CI/CD pipelines |
| **IRSA** | IAM role assumed via Kubernetes OIDC | EKS pod-level permissions without static keys |
| **Identity Centre** | SSO federated access for humans | Console/CLI access for all team members |

### Policy evaluation order

```
1. Explicit DENY in any policy → DENY (always wins)
2. SCP (Organizations) allows?  → if no, DENY
3. Permission boundary allows?  → if no, DENY
4. Identity-based policy allows? → if no, DENY
5. Resource-based policy allows? → if yes, ALLOW (cross-account)
6. → IMPLICIT DENY
```

### Least-privilege role pattern

```hcl
# Role for an ECS task — only what it needs
resource "aws_iam_role" "api_task" {
  name = "${var.project}-api-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_policy" "api_task" {
  name = "${var.project}-api-task"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.db_creds.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.uploads.arn}/*"]
      },
      {
        Effect    = "Allow"
        Action    = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource  = [aws_kms_key.app.arn]
      }
    ]
  })
}
```

!!! warning "Permission Boundaries"
    Use **Permission Boundaries** when delegating IAM management to teams or CI/CD pipelines. The boundary acts as a ceiling — even if a policy grants `*`, the boundary constrains what can actually be used. Prevents privilege escalation through self-service IAM.

---

## AWS Organizations & SCPs

Organizations lets you manage multiple AWS accounts as a single unit. **Service Control Policies (SCPs)** set the maximum permissions available in any member account — they do not grant access, they only restrict.

### SCP key rule

> An action is allowed only if:  
> **IAM policy allows it** AND **SCP does not deny it**

### Common preventive SCPs

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyLeavingOrg",
      "Effect": "Deny",
      "Action": "organizations:LeaveOrganization",
      "Resource": "*"
    },
    {
      "Sid": "DenyDisableCloudTrail",
      "Effect": "Deny",
      "Action": [
        "cloudtrail:StopLogging",
        "cloudtrail:DeleteTrail",
        "cloudtrail:UpdateTrail"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EnforceApprovedRegions",
      "Effect": "Deny",
      "NotAction": [
        "iam:*", "sts:*", "route53:*",
        "support:*", "cloudfront:*", "waf:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["us-east-1", "eu-west-1"]
        }
      }
    }
  ]
}
```

!!! tip "OU structure"
    Use an OU hierarchy: **Root → Security (log archive + audit accounts) → Infrastructure → Workloads (Prod | Non-Prod) → Sandbox**. Attach SCPs at the OU level, never at Root (except deny-list policies that apply everywhere).

---

## KMS — Key Management Service

KMS manages cryptographic keys. It never exposes the CMK (Customer Master Key) material — all encrypt/decrypt operations happen inside KMS HSMs.

### Envelope encryption

Every AWS service uses **envelope encryption**: KMS generates a data key, which is used to encrypt your data. Only the encrypted data key is stored alongside the data; the plaintext data key is discarded after use.

```
Data → [ Encrypt with plaintext data key ] → Ciphertext
         Plaintext data key → [ Encrypt with CMK in KMS ] → Encrypted data key
         Store: Ciphertext + Encrypted data key
```

To decrypt, call `kms:Decrypt` with the encrypted data key → KMS returns the plaintext data key → decrypt your data locally.

```hcl
resource "aws_kms_key" "app" {
  description             = "${var.project} application key"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false

  policy = data.aws_iam_policy_document.kms_app.json
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.project}-app"
  target_key_id = aws_kms_key.app.key_id
}
```

!!! warning "Key policies are mandatory"
    Unlike other AWS resource policies, a KMS key **must** have an explicit key policy. If the policy does not grant the account root access, the key becomes unmanageable. Always include: `"Principal": {"AWS": "arn:aws:iam::ACCOUNT_ID:root"}, "Action": "kms:*"` as a baseline statement.

---

## Secrets Manager

Secrets Manager stores credentials, API keys and arbitrary JSON with **automatic rotation** using Lambda functions. It is the right choice for any secret that needs rotation or cross-account access.

### Secrets Manager vs SSM Parameter Store

| | Secrets Manager | SSM Parameter Store (SecureString) |
|--|----------------|-----------------------------------|
| **Cost** | $0.40/secret/month | Free (standard), $0.05/10k API calls (advanced) |
| **Auto-rotation** | Native (RDS, Redshift, Docdb + custom Lambda) | No |
| **Cross-account** | Yes (resource-based policy) | No |
| **Versioning** | Yes | Yes |
| **Best for** | DB credentials, API keys, anything that rotates | Config values, feature flags, non-rotating secrets |

```hcl
resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.project}/${var.env}/db-credentials"
  kms_key_id              = aws_kms_key.app.arn
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_rotation" "db" {
  secret_id           = aws_secretsmanager_secret.db.id
  rotation_lambda_arn = aws_lambda_function.rotation.arn

  rotation_rules {
    automatically_after_days = 30
  }
}
```

---

## GuardDuty

GuardDuty is a managed threat detection service that analyses VPC Flow Logs, DNS logs, CloudTrail management events and S3 data events using ML + threat intelligence feeds.

### Finding categories

| Category | Example findings |
|----------|----------------|
| **EC2** | CryptoCurrency:Mining, Backdoor:C2, Trojan:DNSExfiltration |
| **IAM** | CredentialAccess:AnomalousBehavior, UnauthorizedAccess:IAMUser |
| **S3** | Discovery:S3/MaliciousIPCaller, Exfiltration:S3/ObjectRead |
| **Kubernetes** | PrivilegeEscalation:Kubernetes/PrivilegedContainer |
| **Malware Protection** | Execution:EC2/MaliciousFile (EBS snapshot scanning) |

```hcl
# Enable GuardDuty for all accounts via Organizations
resource "aws_guardduty_organization_admin_account" "main" {
  admin_account_id = var.security_account_id
}

resource "aws_guardduty_organization_configuration" "main" {
  provider    = aws.security
  auto_enable = "ALL"
  detector_id = aws_guardduty_detector.main.id

  datasources {
    s3_logs             { auto_enable = true }
    kubernetes { audit_logs { enable = true } }
    malware_protection  { scan_ec2_instance_with_findings { ebs_volumes { auto_enable = true } } }
  }
}
```

---

## Security Hub

Security Hub aggregates findings from GuardDuty, Inspector, Macie, IAM Access Analyzer and Firewall Manager into a single prioritised view. It measures posture against security standards.

### Standards

| Standard | Purpose |
|----------|---------|
| **AWS Foundational Security Best Practices** | AWS-native baseline; 300+ controls |
| **CIS AWS Foundations Benchmark** | Industry standard; Levels 1 & 2 |
| **PCI DSS** | Card data compliance controls |
| **NIST SP 800-53** | Federal / FedRAMP baseline |

!!! tip "Auto-remediation"
    Wire Security Hub findings to EventBridge → Lambda for automatic remediation. Common patterns: auto-enable CloudTrail if disabled, auto-revoke overly-permissive security group rules, auto-quarantine compromised IAM credentials.

---

[← AWS Overview](index.md){ .md-button }
[Observability →](observability.md){ .md-button .md-button--primary }
