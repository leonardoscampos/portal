---
title: Azure Storage
description: Blob Storage, Azure Files, Managed Disks, Data Lake Gen2 — storage on Microsoft Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / storage</span>
    <h1 class="dph-title">Azure Storage</h1>
    <p class="dph-desc">Blob Storage for objects and artefacts, Managed Disks for persistent volumes, Azure Files for shared NFS/SMB mounts, and Data Lake Gen2 for analytics pipelines — the full Azure storage stack for DevOps workloads.</p>
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

Azure Blob Storage is the object storage backbone for Azure — artefacts, backups, static websites, container images via ACR and Terraform remote state all rely on it.

### Access tiers

| Tier | Retrieval latency | Min retention | Best for |
|------|------------------|--------------|---------|
| **Hot** | Immediate | None | Frequently accessed data |
| **Cool** | Immediate | 30 days | Backups, infrequent reads |
| **Cold** | Immediate | 90 days | Long-term archives, quarterly access |
| **Archive** | Hours (rehydration) | 180 days | Compliance, 7+ year retention |

### Storage account + blob container

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

### Lifecycle management

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

### Terraform remote state in Azure

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
    For most production workloads use **ZRS** (Zone-Redundant Storage) — synchronous replication across 3 AZs in the same region with no RPO. Use **GRS/GZRS** only when you need cross-region DR with an RPO of ~15 minutes.

---

## Managed Disks

Managed Disks are block storage for Azure VMs and AKS persistent volumes. Azure manages redundancy and placement.

### Disk types

| Type | Max IOPS | Max throughput | Use case |
|------|---------|---------------|---------|
| **Standard HDD** | 2,000 | 500 MB/s | Dev/test, cold data |
| **Standard SSD** | 6,000 | 750 MB/s | Web servers, lightly loaded DBs |
| **Premium SSD v1** | 20,000 | 900 MB/s | Production databases |
| **Premium SSD v2** | 80,000 | 1,200 MB/s | High-throughput databases, Kafka |
| **Ultra Disk** | 160,000 | 4,000 MB/s | SAP HANA, top-tier DB workloads |

!!! note "Ephemeral OS disks"
    For AKS node pools, always use **Ephemeral OS disks** (`os_disk_type = "Ephemeral"`). They use local VM storage rather than a separate Managed Disk — faster node provisioning, lower latency for OS operations and zero disk cost.

### AKS storage classes

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

Azure Files provides fully managed SMB and NFS file shares accessible from Azure and on-premises simultaneously. Mounted directly in AKS pods via the Azure Files CSI driver.

### Share tiers

| Tier | Protocol | Performance | Best for |
|------|---------|------------|---------|
| **Transaction Optimised** | SMB / REST | Standard HDD-backed | Shared config, low-IOPS |
| **Hot** | SMB / REST | Standard SSD | General-purpose shared storage |
| **Cool** | SMB / REST | Standard HDD, lowest cost | Archives, infrequent access |
| **Premium** | SMB / NFS | SSD-backed, low latency | Databases, CI caches, containers |

```hcl
resource "azurerm_storage_share" "apps" {
  name               = "apps-shared"
  storage_account_id = azurerm_storage_account.shared.id
  quota              = 100  # GB
  enabled_protocol   = "NFS"
}
```

### Mount in Kubernetes (RWX)

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

ADLS Gen2 is Blob Storage with a hierarchical namespace enabled — gives POSIX-compatible directory operations, ACLs at the file/folder level and optimised analytics performance for Spark, Databricks and Synapse workloads.

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

Azure Backup is the managed backup service for VMs, Managed Disks, Azure Files, Azure Database for PostgreSQL and AKS volumes.

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

[← Azure Overview](index.md){ .md-button }
[Networking →](networking.md){ .md-button .md-button--primary }
