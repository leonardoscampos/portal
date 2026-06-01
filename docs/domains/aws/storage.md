---
title: AWS Armazenamento
description: S3, EBS, EFS, FSx — armazenamento de objetos, blocos e arquivos na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / storage</span>
    <h1 class="dph-title">AWS Armazenamento</h1>
    <p class="dph-desc">Armazenamento de objetos em escala ilimitada, armazenamento em bloco para bancos de dados, sistemas de arquivos gerenciados para cargas compartilhadas — a stack completa de armazenamento AWS mapeada para padrões DevOps do mundo real.</p>
    <div class="dph-badges">
      <span class="tech-badge">S3</span>
      <span class="tech-badge">EBS</span>
      <span class="tech-badge">EFS</span>
      <span class="tech-badge">FSx</span>
      <span class="tech-badge">Glacier</span>
      <span class="tech-badge">Storage Gateway</span>
    </div>
  </div>
</div>

---

## S3 — Simple Storage Service

O S3 é a espinha dorsal do armazenamento AWS. Onze noves de durabilidade, capacidade ilimitada, API compatível com S3, notificações de eventos nativas e automação de ciclo de vida fazem dele a escolha padrão para artefatos, backups, data lakes e assets estáticos.

### Classes de armazenamento

| Classe | Recuperação | Duração mínima | Melhor para |
|--------|-------------|----------------|-------------|
| **Standard** | Imediata | Nenhuma | Dados acessados frequentemente |
| **Standard-IA** | Imediata | 30 dias | Backups, réplicas de DR |
| **One Zone-IA** | Imediata | 30 dias | Dados recriáveis, IA com menor custo |
| **Intelligent-Tiering** | Imediata / minutos / horas | Nenhuma | Padrões de acesso desconhecidos ou variáveis |
| **Glacier Instant** | Imediata | 90 dias | Arquivos acessados poucas vezes/ano |
| **Glacier Flexible** | Minutos – horas | 90 dias | Backups de longo prazo |
| **Glacier Deep Archive** | 12–48 horas | 180 dias | Conformidade, retenção 7+ anos |

### Criptografia

Todos os novos buckets S3 criptografam objetos por padrão usando **SSE-S3** (AES-256, chaves gerenciadas pela AWS). Mude para **SSE-KMS** quando precisar de CMKs gerenciadas pelo cliente, trilhas de auditoria de rotação de chaves ou controle de acesso entre contas.

```hcl
resource "aws_s3_bucket" "artefacts" {
  bucket = "${var.project}-artefacts-${var.env}"
}

resource "aws_s3_bucket_versioning" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true  # reduz custos de requisições KMS em ~99%
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artefacts" {
  bucket = aws_s3_bucket.artefacts.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter { prefix = "" }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }
    noncurrent_version_expiration { noncurrent_days = 90 }

    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket_public_access_block" "artefacts" {
  bucket                  = aws_s3_bucket.artefacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

!!! tip "Bucket Key"
    Sempre habilite `bucket_key_enabled = true` em buckets com SSE-KMS. Isso gera uma chave de dados de curta duração armazenada em cache no nível do bucket, reduzindo chamadas à API KMS (e custos) em até 99% para buckets com muitos objetos pequenos.

### Notificações de eventos

Eventos S3 (ObjectCreated, ObjectRemoved, etc.) podem ser distribuídos para Lambda, SQS, SNS ou EventBridge. Prefira o **EventBridge** para filtragem refinada e roteamento para múltiplos destinos sem funções Lambda extras.

```hcl
resource "aws_s3_bucket_notification" "uploads" {
  bucket      = aws_s3_bucket.uploads.id
  eventbridge = true  # roteia todos os eventos para o bus padrão do EventBridge
}
```

---

## EBS — Elastic Block Store

O EBS fornece volumes de bloco persistentes anexados a instâncias EC2. Os volumes residem em uma única AZ e são replicados automaticamente dentro dessa AZ.

### Tipos de volume

| Tipo | IOPS | Throughput | Caso de uso |
|------|------|-----------|-------------|
| **gp3** (padrão) | 3.000–16.000 | 125–1.000 MB/s | Uso geral, volumes de boot, PVs no Kubernetes |
| **gp2** (legado) | 3 IOPS/GB, até 16.000 | Burstável | Legado; migre para gp3 |
| **io2 / io2 Block Express** | até 256.000 | até 4.000 MB/s | Bancos de dados de alto desempenho (Oracle, SQL Server) |
| **st1** (HDD) | 500 | 500 MB/s | Sequencial com alto throughput: Kafka, armazenamento de logs |
| **sc1** (HDD frio) | 250 | 250 MB/s | Dados frios, menor custo por GB |

!!! note "gp3 vs gp2"
    **Sempre use gp3**. É mais barato que o gp2 no mesmo tamanho, e IOPS/throughput são configurados independentemente do tamanho do disco — não é necessário superdimensionar o tamanho apenas para obter IOPS.

```hcl
resource "aws_ebs_volume" "data" {
  availability_zone = "${var.region}a"
  size              = 500
  type              = "gp3"
  iops              = 6000
  throughput        = 250
  encrypted         = true
  kms_key_id        = aws_kms_key.ebs.arn

  tags = { Name = "db-data" }
}
```

### Snapshots e automação

Os Snapshots do EBS são incrementais e armazenados no S3 (gerenciado pela AWS). Use o **Amazon Data Lifecycle Manager (DLM)** para agendamentos automáticos de snapshots e políticas de retenção. Cópia entre regiões para DR.

```hcl
resource "aws_dlm_lifecycle_policy" "daily_snapshot" {
  description        = "Snapshot EBS diário — retenção de 14 dias"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Backup = "true" }

    schedule {
      name = "Daily"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["02:00"]
      }
      retain_rule { count = 14 }
      copy_tags = true
    }
  }
}
```

---

## EFS — Elastic File System

O EFS é um sistema de arquivos NFS (NFSv4) gerenciado que escala automaticamente e é acessível por múltiplas instâncias EC2, tasks ECS ou pods EKS simultaneamente — na mesma AZ ou em múltiplas AZs.

### Modos de performance e throughput

| Modo | Descrição |
|------|-----------|
| **General Purpose** (padrão) | Menor latência; adequado para a maioria das cargas |
| **Max I/O** | Maior throughput agregado com maior latência; legado, use apenas para HPC |
| **Elastic throughput** (padrão) | Escala automaticamente com a carga; melhor para padrões de acesso esporádico |
| **Provisioned throughput** | MiB/s fixo independente do tamanho do armazenamento; para alto throughput sustentado |
| **Bursting throughput** | Throughput escala com o tamanho do armazenamento + créditos de burst; cargas previsíveis |

```hcl
resource "aws_efs_file_system" "shared" {
  encrypted        = true
  kms_key_id       = aws_kms_key.efs.arn
  throughput_mode  = "elastic"
  performance_mode = "generalPurpose"

  lifecycle_policy {
    transition_to_ia                    = "AFTER_30_DAYS"
    transition_to_primary_storage_class = "AFTER_1_ACCESS"
  }
}

resource "aws_efs_mount_target" "az" {
  for_each        = toset(var.private_subnet_ids)
  file_system_id  = aws_efs_file_system.shared.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}
```

### EFS no Kubernetes

Monte volumes EFS em pods EKS via **EFS CSI driver** (add-on `aws-efs-csi-driver`). Use `accessModes: ReadWriteMany` para montagens compartilhadas entre pods.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: efs-sc
provisioner: efs.csi.aws.com
parameters:
  provisioningMode: efs-ap        # usa EFS Access Points
  fileSystemId: fs-0123456789abcdef
  directoryPerms: "700"
```

---

## FSx — Sistemas de Arquivos Gerenciados

O FSx oferece sistemas de arquivos gerenciados para cargas especializadas onde o EFS (NFS) é insuficiente.

| Variante | Protocolo | Melhor para |
|----------|-----------|-------------|
| **FSx for Lustre** | Lustre | HPC, treinamento ML, I/O paralelo; pode vincular ao S3 |
| **FSx for Windows** | SMB / NFS | Cargas Windows, integração com Active Directory |
| **FSx for NetApp ONTAP** | NFS / SMB / iSCSI | NAS empresarial, replicação SnapMirror, multi-protocolo |
| **FSx for OpenZFS** | NFS | Snapshots e clones ZFS; lift-and-shift de ZFS on-prem |

!!! example "FSx for Lustre ↔ S3"
    O FSx for Lustre pode ser vinculado a um bucket S3 como repositório de dados. Os arquivos são carregados do S3 sob demanda no primeiro acesso e podem ser exportados de volta — ideal para pipelines de ML onde os dados de treinamento ficam no S3, mas precisam de acesso POSIX de alto throughput.

---

## Glacier e Arquivamento

O S3 Glacier não é um serviço separado — é acessado via **classes de armazenamento do S3**. Use regras de ciclo de vida para transicionar objetos para a camada Glacier adequada.

| Camada | Latência do primeiro byte | Custo típico |
|--------|---------------------------|--------------|
| Glacier Instant Retrieval | Milissegundos | ~$0,004/GB/mês |
| Glacier Flexible Retrieval | 1–5 min (Expedited), 3–5 h (Standard), 5–12 h (Bulk) | ~$0,0036/GB/mês |
| Glacier Deep Archive | 12 h (Standard), 48 h (Bulk) | ~$0,00099/GB/mês |

!!! tip "Vault Lock para conformidade"
    Use o **S3 Object Lock** no modo compliance (WORM) para impedir exclusão ou sobrescrita por um período de retenção fixo. Necessário para SEC 17a-4, CFTC 1.31 e regulamentações similares.

---

[← Computação](compute.md){ .md-button }
[Rede →](networking.md){ .md-button .md-button--primary }
