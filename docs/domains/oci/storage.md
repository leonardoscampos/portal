---
title: OCI Armazenamento
description: Object Storage, Block Volumes, File Storage, Archive Storage — armazenamento na Oracle Cloud Infrastructure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / storage</span>
    <h1 class="dph-title">OCI Armazenamento</h1>
    <p class="dph-desc">O OCI Object Storage oferece uma API compatível com S3 e é o local padrão para estado do Terraform, artefatos e dados. Os Block Volumes entregam IOPS ultra-altos com preços previsíveis. O File Storage fornece montagens NFS v3/v4.1 compartilhadas para clusters.</p>
    <div class="dph-badges">
      <span class="tech-badge">Object Storage</span>
      <span class="tech-badge">Block Volumes</span>
      <span class="tech-badge">File Storage</span>
      <span class="tech-badge">Archive Storage</span>
    </div>
  </div>
</div>

---

## Object Storage

O OCI Object Storage é um armazenamento de objetos durável regionalmente e compatível com S3. É usado para estado remoto do Terraform, artefatos de build, camadas de imagens de contêiner (OCIR), ingestão de data lake e destinos de backup.

### Camadas de armazenamento

| Camada | Descrição | Retenção mínima | Caso de uso |
|--------|-----------|-----------------|-------------|
| **Standard** | Hot, acesso frequente | Nenhuma | Artefatos, arquivos de estado, dados ativos |
| **Infrequent Access** | Menor custo de armazenamento, maior custo de recuperação | 31 dias | Backups, logs |
| **Archive** | Menor custo, restauração necessária antes da leitura | 90 dias | Conformidade de longo prazo |

### Compatibilidade com S3

O OCI Object Storage expõe um endpoint compatível com o Amazon S3. A maioria das ferramentas S3 (AWS CLI, backend S3 do Terraform, s3fs, rclone) funciona nativamente com o OCI Object Storage:

```
Endpoint: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
```

### Bucket para estado do Terraform

```hcl
resource "oci_objectstorage_bucket" "tfstate" {
  compartment_id = var.compartment_id
  namespace      = data.oci_objectstorage_namespace.current.namespace
  name           = "${var.project}-tfstate"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Enabled"

  defined_tags = {
    "Operations.Environment" = var.env
  }
}
```

### Backend Terraform (compatível com S3)

```hcl
terraform {
  backend "s3" {
    bucket   = "my-project-tfstate"
    key      = "prod/oke/terraform.tfstate"
    region   = "us-ashburn-1"
    endpoint = "https://<namespace>.compat.objectstorage.us-ashburn-1.oraclecloud.com"

    # OCI credentials
    access_key = var.oci_access_key_id
    secret_key = var.oci_secret_access_key

    # OCI-specific
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    force_path_style            = true
  }
}
```

### Política de ciclo de vida

```hcl
resource "oci_objectstorage_object_lifecycle_policy" "artefacts" {
  namespace = data.oci_objectstorage_namespace.current.namespace
  bucket    = oci_objectstorage_bucket.artefacts.name

  rules {
    name        = "tier-to-infrequent"
    action      = "INFREQUENT_ACCESS"
    is_enabled  = true
    time_amount = 30
    time_unit   = "DAYS"
    object_name_filter { inclusion_patterns = ["builds/*"] }
  }

  rules {
    name        = "archive-old"
    action      = "ARCHIVE"
    is_enabled  = true
    time_amount = 90
    time_unit   = "DAYS"
    object_name_filter { inclusion_patterns = ["builds/*"] }
  }

  rules {
    name        = "expire-untagged-builds"
    action      = "DELETE"
    is_enabled  = true
    time_amount = 365
    time_unit   = "DAYS"
    object_name_filter { inclusion_patterns = ["builds/*"] }
  }
}
```

!!! tip "Pre-Authenticated Requests"
    Use **Pre-Authenticated Requests (PARs)** para conceder acesso temporário e sem credenciais a objetos ou buckets específicos — útil para compartilhar artefatos com parceiros externos sem expor credenciais IAM.

---

## Block Volumes

Os OCI Block Volumes são armazenamento em bloco de alto desempenho anexado a instâncias de Computação e volumes persistentes do OKE. Os Block Volumes são replicados automaticamente em 3 domínios de falha dentro de um Availability Domain.

### Camadas de desempenho

| Camada | IOPS/GB | IOPS máx. | Throughput máx. | Caso de uso |
|--------|---------|-----------|-----------------|-------------|
| **Lower Cost** | 2 | 3.000 | 480 MB/s | Dev/teste |
| **Balanced** | 10 | 25.000 | 480 MB/s | Cargas de trabalho gerais |
| **Higher Performance** | 20 | 35.000 | 480 MB/s | Bancos de dados |
| **Ultra-High Performance** | 30–120 | 300.000 | 2.680 MB/s | BDs de missão crítica |

!!! tip "Ultra-High Performance"
    A camada **Ultra-High Performance** da OCI suporta até 300.000 IOPS e 2.680 MB/s de throughput — significativamente mais do que ofertas comparáveis da AWS (EBS io2) ou Azure (Ultra Disk) no mesmo patamar de preço.

```hcl
resource "oci_core_volume" "database" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_id
  display_name        = "${var.project}-db-volume"
  size_in_gbs         = 1000
  vpus_per_gb         = 20  # Higher Performance tier

  is_auto_tune_enabled = true   # automatically adjusts IOPS based on usage

  defined_tags = { "Operations.Environment" = var.env }
}

resource "oci_core_volume_attachment" "database" {
  instance_id     = oci_core_instance.database.id
  volume_id       = oci_core_volume.database.id
  attachment_type = "paravirtualized"
  is_read_only    = false
  is_shareable    = false
}
```

### Classes de armazenamento do OKE

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: oci-bv-high-performance
provisioner: blockvolume.csi.oraclecloud.com
parameters:
  vpusPerGB: "20"       # Higher Performance tier
  attachment-type: paravirtualized
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
```

### Backup de Volume

```hcl
resource "oci_core_volume_backup_policy" "production" {
  compartment_id = var.compartment_id
  display_name   = "production-backup-policy"

  schedules {
    backup_type       = "INCREMENTAL"
    period            = "ONE_DAY"
    retention_seconds = 1209600   # 14 days
    hour_of_day       = 2
    day_of_week       = "MONDAY"
    timezone          = "UTC"
  }

  schedules {
    backup_type       = "FULL"
    period            = "ONE_WEEK"
    retention_seconds = 7776000   # 90 days
    day_of_week       = "SUNDAY"
    timezone          = "UTC"
  }
}

resource "oci_core_volume_backup_policy_assignment" "database" {
  asset_id  = oci_core_volume.database.id
  policy_id = oci_core_volume_backup_policy.production.id
}
```

---

## File Storage

O OCI File Storage fornece um sistema de arquivos compartilhado NFS v3 e NFSv4.1 totalmente gerenciado. Os Mount targets expõem o endpoint NFS dentro de uma sub-rede VCN; os sistemas de arquivos podem ser montados por múltiplas instâncias de Computação e pods OKE simultaneamente.

```hcl
resource "oci_file_storage_file_system" "shared" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_id
  display_name        = "${var.project}-shared-fs"
}

resource "oci_file_storage_mount_target" "main" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_id
  subnet_id           = oci_core_subnet.storage.id
  display_name        = "${var.project}-mount-target"
  nsg_ids             = [oci_core_network_security_group.nfs.id]
}

resource "oci_file_storage_export" "shared" {
  export_set_id  = oci_file_storage_mount_target.main.export_set_id
  file_system_id = oci_file_storage_file_system.shared.id
  path           = "/shared"

  export_options {
    source              = "0.0.0.0/0"
    access              = "READ_WRITE"
    identity_squash     = "ROOT"
    anonymous_uid       = 65534
    anonymous_gid       = 65534
    require_privileged_source_port = false
  }
}
```

### Montagem em pods OKE

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: oci-fss-pv
spec:
  capacity:
    storage: 500Gi
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  csi:
    driver: fss.csi.oraclecloud.com
    volumeHandle: "<file-system-ocid>:<mount-target-ip>:/<export-path>"
    volumeAttributes:
      encryptInTransit: "true"
```

---

## Archive Storage

O OCI Archive Storage é a camada de armazenamento de menor custo dentro do Object Storage — 10× mais barato que o Standard. Os objetos devem ser restaurados (leva até 1 hora) antes de serem baixados.

Casos de uso: arquivos de conformidade regulatória, cópias finais de backup, dados de recuperação de desastres frios.

| Atributo | Detalhes |
|----------|---------|
| Retenção mínima | 90 dias |
| Tempo de restauração | Até 1 hora |
| Preço | ~$0,001/GB/mês (dependente da região) |
| Acesso | Via API do Object Storage após restauração |

---

[← Visão Geral OCI](index.md){ .md-button }
[Rede →](networking.md){ .md-button .md-button--primary }
