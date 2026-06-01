---
title: Azure Storage
description: Blob Storage para objetos e artefatos, Managed Disks para volumes persistentes, Azure Files para montagens NFS/SMB compartilhadas e Data Lake Gen2 para pipelines de analytics — a stack completa de armazenamento Azure para cargas de trabalho DevOps.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / storage</span>
    <h1 class="dph-title">Azure Storage</h1>
    <p class="dph-desc">Blob Storage para objetos e artefatos, Managed Disks para volumes persistentes, Azure Files para montagens NFS/SMB compartilhadas e Data Lake Gen2 para pipelines de analytics — a stack completa de armazenamento Azure para cargas de trabalho DevOps.</p>
    <div class="dph-badges">
      <span class="tech-badge">Blob Storage</span>
      <span class="tech-badge">Azure Files</span>
      <span class="tech-badge">Managed Disks</span>
      <span class="tech-badge">Data Lake Gen2</span>
      <span class="tech-badge">Azure Backup</span>
    </div>
  </div>
</div>

---

## Blob Storage

Azure Blob Storage é a espinha dorsal de armazenamento de objetos do Azure — artefatos, backups, sites estáticos, imagens de container via ACR e estado remoto do Terraform, todos dependem dele.

### Camadas de Acesso

| Camada | Latência de acesso | Retenção mínima | Melhor para |
|--------|--------------------|-----------------|-------------|
| **Hot** | Imediata | Nenhuma | Dados acessados com frequência |
| **Cool** | Imediata | 30 dias | Backups, leituras infrequentes |
| **Cold** | Imediata | 90 dias | Arquivos de longo prazo, acesso trimestral |
| **Archive** | Horas (reidratação) | 180 dias | Conformidade, retenção de 7+ anos |

### Conta de Armazenamento + Container Blob

```hcl
resource "azurerm_storage_account" "artefacts" {
  name                     = "${var.project}artefacts${var.env}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "ZRS"         # zone-redundant
  min_tls_version          = "TLS1_2"
  https_traffic_only_enabled = true
  allow_nested_items_to_be_public = false  # block anonymous access

  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 30 }
    container_delete_retention_policy { days = 7 }
  }

  identity { type = "SystemAssigned" }
}

resource "azurerm_storage_container" "artefacts" {
  name                  = "artefacts"
  storage_account_id    = azurerm_storage_account.artefacts.id
  container_access_type = "private"
}
```

### Gerenciamento de Ciclo de Vida

```hcl
resource "azurerm_storage_management_policy" "artefacts" {
  storage_account_id = azurerm_storage_account.artefacts.id

  rule {
    name    = "tier-and-expire"
    enabled = true
    filters {
      blob_types   = ["blockBlob"]
      prefix_match = ["builds/"]
    }
    actions {
      base_blob {
        tier_to_cool_after_days_since_modification_greater_than    = 30
        tier_to_archive_after_days_since_modification_greater_than = 90
        delete_after_days_since_modification_greater_than          = 365
      }
      snapshot {
        delete_after_days_since_creation_greater_than = 30
      }
    }
  }
}
```

### Estado Remoto do Terraform no Azure

```hcl
# backend.tf
terraform {
  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "myprojecttfstate"
    container_name       = "tfstate"
    key                  = "prod/eastus/aks/terraform.tfstate"
    use_oidc             = true   # federated identity — no storage key needed
  }
}
```

!!! tip "ZRS vs GRS"
    Para a maioria das cargas de trabalho em produção, use **ZRS** (Armazenamento com Redundância de Zona) — replicação síncrona em 3 AZs na mesma região sem RPO. Use **GRS/GZRS** somente quando precisar de DR entre regiões com RPO de ~15 minutos.

---

## Managed Disks

Managed Disks são armazenamento em bloco para VMs Azure e volumes persistentes do AKS. O Azure gerencia a redundância e o posicionamento.

### Tipos de Disco

| Tipo | IOPS máximos | Throughput máximo | Caso de uso |
|------|-------------|-------------------|-------------|
| **Standard HDD** | 2.000 | 500 MB/s | Dev/teste, dados frios |
| **Standard SSD** | 6.000 | 750 MB/s | Servidores web, bancos de dados com pouca carga |
| **Premium SSD v1** | 20.000 | 900 MB/s | Bancos de dados em produção |
| **Premium SSD v2** | 80.000 | 1.200 MB/s | Bancos de dados de alto throughput, Kafka |
| **Ultra Disk** | 160.000 | 4.000 MB/s | SAP HANA, cargas de trabalho de banco de dados de alto nível |

!!! note "Discos de SO efêmeros"
    Para node pools do AKS, sempre use **discos de SO efêmeros** (`os_disk_type = "Ephemeral"`). Eles usam armazenamento local da VM em vez de um Managed Disk separado — provisionamento de nó mais rápido, menor latência para operações de SO e custo zero de disco.

### Classes de Armazenamento AKS

```yaml
# Premium SSD v2 storage class for AKS
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: premium-ssd-v2
provisioner: disk.csi.azure.com
parameters:
  skuName: PremiumV2_LRS
  cachingMode: None        # required for Premium SSD v2
  diskIOPSReadWrite: "8000"
  diskMBpsReadWrite: "200"
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

---

## Azure Files

Azure Files fornece compartilhamentos de arquivos SMB e NFS totalmente gerenciados, acessíveis do Azure e on-premises simultaneamente. Montados diretamente em pods do AKS via driver CSI do Azure Files.

### Camadas de Compartilhamento

| Camada | Protocolo | Desempenho | Melhor para |
|--------|-----------|------------|-------------|
| **Transaction Optimised** | SMB / REST | Com suporte de HDD Padrão | Config compartilhada, baixo IOPS |
| **Hot** | SMB / REST | SSD Padrão | Armazenamento compartilhado de uso geral |
| **Cool** | SMB / REST | HDD Padrão, menor custo | Arquivos, acesso infrequente |
| **Premium** | SMB / NFS | Com suporte de SSD, baixa latência | Bancos de dados, caches de CI, containers |

```hcl
resource "azurerm_storage_share" "apps" {
  name               = "apps-shared"
  storage_account_id = azurerm_storage_account.shared.id
  quota              = 100  # GB
  enabled_protocol   = "NFS"
}
```

### Montagem no Kubernetes (RWX)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: azure-files-pv
spec:
  capacity:
    storage: 100Gi
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  csi:
    driver: file.csi.azure.com
    volumeHandle: apps-shared
    volumeAttributes:
      storageAccount: mystorageaccount
      shareName: apps-shared
      protocol: nfs
```

---

## Data Lake Storage Gen2

ADLS Gen2 é o Blob Storage com namespace hierárquico habilitado — fornece operações de diretório compatíveis com POSIX, ACLs no nível de arquivo/pasta e desempenho de analytics otimizado para cargas de trabalho Spark, Databricks e Synapse.

```hcl
resource "azurerm_storage_account" "datalake" {
  name                     = "${var.project}datalake"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "ZRS"
  is_hns_enabled           = true   # enables hierarchical namespace = ADLS Gen2
  min_tls_version          = "TLS1_2"
  https_traffic_only_enabled = true
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_data_lake_gen2_filesystem" "raw" {
  name               = "raw"
  storage_account_id = azurerm_storage_account.datalake.id
}
```

---

## Azure Backup

Azure Backup é o serviço de backup gerenciado para VMs, Managed Disks, Azure Files, Azure Database for PostgreSQL e volumes do AKS.

```hcl
resource "azurerm_recovery_services_vault" "main" {
  name                = "${var.project}-rsv"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"
  soft_delete_enabled = true
}

resource "azurerm_backup_policy_vm" "daily" {
  name                = "daily-vm-backup"
  resource_group_name = azurerm_resource_group.main.name
  recovery_vault_name = azurerm_recovery_services_vault.main.name

  backup { frequency = "Daily"; time = "23:00" }
  retention_daily    { count = 14 }
  retention_weekly   { count = 4; weekdays = ["Sunday"] }
  retention_monthly  { count = 3; weeks = ["Last"]; weekdays = ["Sunday"] }
}
```

---

[← Visão Geral Azure](index.md){ .md-button }
[Rede →](networking.md){ .md-button .md-button--primary }
