---
title: AWS Segurança & IAM
description: IAM, Organizations, KMS, Secrets Manager, GuardDuty — fundamentos de segurança e identidade na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / security</span>
    <h1 class="dph-title">Segurança &amp; IAM</h1>
    <p class="dph-desc">Identidade com menor privilégio, criptografia em envelope, rotação de segredos, detecção de ameaças e guardrails de conformidade — o modelo de segurança AWS dos primeiros princípios à governança multi-conta pronta para produção.</p>
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

O IAM é o plano de controle de acesso para todos os serviços AWS. Toda chamada de API é avaliada pelo motor de políticas do IAM.

### Tipos de identidade

| Tipo | Descrição | Quando usar |
|------|-----------|-------------|
| **IAM User** | Credenciais de longa duração (access key + senha) | Somente acesso de emergência break-glass; evite para cargas de trabalho |
| **IAM Role** | Credenciais temporárias via STS; assumida por principals | Instance profiles EC2, funções Lambda, pipelines CI/CD |
| **IRSA** | Role IAM assumida via OIDC do Kubernetes | Permissões em nível de pod EKS sem chaves estáticas |
| **Identity Centre** | Acesso federado SSO para pessoas | Acesso ao console/CLI para todos os membros do time |

### Ordem de avaliação de políticas

```
1. DENY explícito em qualquer política → DENY (sempre prevalece)
2. SCP (Organizations) permite?        → se não, DENY
3. Permission boundary permite?        → se não, DENY
4. Política baseada em identidade permite? → se não, DENY
5. Política baseada em recurso permite?    → se sim, ALLOW (cross-account)
6. → IMPLICIT DENY
```

### Padrão de role com menor privilégio

```hcl
# Role para uma task ECS — apenas o que ela precisa
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
    Use **Permission Boundaries** ao delegar gerenciamento de IAM para times ou pipelines CI/CD. O boundary age como um teto — mesmo que uma política conceda `*`, o boundary limita o que pode ser efetivamente usado. Previne escalada de privilégios via IAM self-service.

---

## AWS Organizations & SCPs

O Organizations permite gerenciar múltiplas contas AWS como uma única unidade. As **Service Control Policies (SCPs)** definem as permissões máximas disponíveis em qualquer conta membro — elas não concedem acesso, apenas restringem.

### Regra principal das SCPs

> Uma ação é permitida somente se:  
> **A política IAM permite** E **o SCP não nega**

### SCPs preventivos comuns

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

!!! tip "Estrutura de OUs"
    Use uma hierarquia de OUs: **Root → Security (contas log archive + audit) → Infrastructure → Workloads (Prod | Non-Prod) → Sandbox**. Aplique SCPs no nível da OU, nunca no Root (exceto políticas de deny-list que se aplicam a todos).

---

## KMS — Key Management Service

O KMS gerencia chaves criptográficas. Ele nunca expõe o material da CMK (Customer Master Key) — todas as operações de encrypt/decrypt acontecem dentro dos HSMs do KMS.

### Criptografia em envelope

Todo serviço AWS usa **criptografia em envelope**: o KMS gera uma data key, que é usada para criptografar seus dados. Apenas a data key criptografada é armazenada junto aos dados; a data key em texto simples é descartada após o uso.

```
Dados → [ Criptografar com data key em texto simples ] → Ciphertext
         Data key em texto simples → [ Criptografar com CMK no KMS ] → Data key criptografada
         Armazenar: Ciphertext + Data key criptografada
```

Para descriptografar, chame `kms:Decrypt` com a data key criptografada → KMS retorna a data key em texto simples → descriptografe seus dados localmente.

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

!!! warning "Políticas de chave são obrigatórias"
    Ao contrário de outras políticas de recursos AWS, uma chave KMS **deve** ter uma política de chave explícita. Se a política não conceder acesso root à conta, a chave fica impossível de gerenciar. Sempre inclua: `"Principal": {"AWS": "arn:aws:iam::ACCOUNT_ID:root"}, "Action": "kms:*"` como declaração base.

---

## Secrets Manager

O Secrets Manager armazena credenciais, chaves de API e JSON arbitrário com **rotação automática** usando funções Lambda. É a escolha certa para qualquer segredo que precise de rotação ou acesso entre contas.

### Secrets Manager vs SSM Parameter Store

| | Secrets Manager | SSM Parameter Store (SecureString) |
|--|----------------|-----------------------------------|
| **Custo** | $0,40/segredo/mês | Gratuito (standard), $0,05/10k chamadas API (advanced) |
| **Auto-rotação** | Nativa (RDS, Redshift, Docdb + Lambda personalizado) | Não |
| **Cross-account** | Sim (política baseada em recurso) | Não |
| **Versionamento** | Sim | Sim |
| **Melhor para** | Credenciais de BD, chaves de API, qualquer coisa que rotaciona | Valores de config, feature flags, segredos sem rotação |

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

O GuardDuty é um serviço gerenciado de detecção de ameaças que analisa VPC Flow Logs, logs DNS, eventos de gerenciamento do CloudTrail e eventos de dados S3 usando ML + feeds de inteligência de ameaças.

### Categorias de findings

| Categoria | Exemplos de findings |
|-----------|---------------------|
| **EC2** | CryptoCurrency:Mining, Backdoor:C2, Trojan:DNSExfiltration |
| **IAM** | CredentialAccess:AnomalousBehavior, UnauthorizedAccess:IAMUser |
| **S3** | Discovery:S3/MaliciousIPCaller, Exfiltration:S3/ObjectRead |
| **Kubernetes** | PrivilegeEscalation:Kubernetes/PrivilegedContainer |
| **Malware Protection** | Execution:EC2/MaliciousFile (escaneamento de snapshot EBS) |

```hcl
# Habilitar GuardDuty para todas as contas via Organizations
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

O Security Hub agrega findings do GuardDuty, Inspector, Macie, IAM Access Analyzer e Firewall Manager em uma visão única e priorizada. Mede a postura de segurança em relação a padrões.

### Padrões

| Padrão | Propósito |
|--------|-----------|
| **AWS Foundational Security Best Practices** | Baseline nativo AWS; 300+ controles |
| **CIS AWS Foundations Benchmark** | Padrão do setor; Níveis 1 & 2 |
| **PCI DSS** | Controles de conformidade para dados de cartão |
| **NIST SP 800-53** | Baseline federal / FedRAMP |

!!! tip "Auto-remediação"
    Conecte findings do Security Hub ao EventBridge → Lambda para remediação automática. Padrões comuns: habilitar CloudTrail automaticamente se desabilitado, revogar automaticamente regras de security group excessivamente permissivas, colocar em quarentena credenciais IAM comprometidas.

---

[← Visão Geral AWS](index.md){ .md-button }
[Observabilidade →](observability.md){ .md-button .md-button--primary }
