---
title: GCP Storage
description: Cloud Storage, Persistent Disk, Filestore, Cloud SQL, AlloyDB — storage on Google Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / storage</span>
    <h1 class="dph-title">GCP Storage</h1>
    <p class="dph-desc">Cloud Storage (GCS) is the backbone — objects, artefacts, Terraform state, data lake. Persistent Disk for VM and GKE block storage. Filestore for shared NFS. Cloud SQL and AlloyDB for managed relational databases.</p>
    <div class="dph-badges">
      <span class="tech-badge">Cloud Storage</span>
      <span class="tech-badge">Persistent Disk</span>
      <span class="tech-badge">Filestore</span>
      <span class="tech-badge">Cloud SQL</span>
      <span class="tech-badge">AlloyDB</span>
    </div>
  </div>
</div>

---

## Cloud Storage (GCS)

GCS is GCP's object storage — globally unique bucket names, flat namespace, eventual consistency replaced by strong consistency in 2021. It is the Terraform backend, container build cache, artefact store and data lake foundation for most GCP workloads.

### Storage classes

| Class | Minimum storage | Access | Use case |
|-------|----------------|--------|---------|
| **Standard** | None | Immediate | Hot data, frequently accessed |
| **Nearline** | 30 days | Immediate | Monthly access, backups |
| **Coldline** | 90 days | Immediate | Quarterly access, DR |
| **Archive** | 365 days | Immediate (higher egress cost) | 7+ year retention, compliance |

### Terraform state bucket

```hcl
resource "google_storage_bucket" "tfstate" {
  name          = "${var.project}-tfstate"
  location      = "US"
  force_destroy = false

  versioning { enabled = true }

  lifecycle_rule {
    action { type = "Delete" }
    condition {
      num_newer_versions = 10          # keep last 10 state versions
      with_state         = "ARCHIVED"
    }
  }

  uniform_bucket_level_access = true  # disable legacy ACLs
  public_access_prevention    = "enforced"
}
```

### GCS backend config

```hcl
terraform {
  backend "gcs" {
    bucket = "my-project-tfstate"
    prefix = "prod/us-central1/gke"
  }
}
```

### Lifecycle management

```hcl
resource "google_storage_bucket" "artefacts" {
  name     = "${var.project}-artefacts"
  location = var.region

  lifecycle_rule {
    action { type = "SetStorageClass"; storage_class = "NEARLINE" }
    condition { age = 30 }
  }

  lifecycle_rule {
    action { type = "SetStorageClass"; storage_class = "COLDLINE" }
    condition { age = 90 }
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 365 }
  }

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
}
```

!!! tip "Uniform bucket-level access"
    Always enable `uniform_bucket_level_access`. This disables legacy object-level ACLs and enforces IAM-only access control — simpler to audit and manage at scale.

---

## Persistent Disk

Persistent Disk (PD) is GCP's block storage for Compute Engine VMs and GKE persistent volumes. Unlike AWS EBS, PD can be mounted **read-only to multiple VMs simultaneously**.

### Disk types

| Type | Max IOPS | Max throughput | Use case |
|------|---------|---------------|---------|
| **pd-standard** | 3,000 | 180 MB/s | Dev/test, cold data |
| **pd-balanced** | 15,000 | 240 MB/s | General workloads |
| **pd-ssd** | 60,000 | 1,200 MB/s | Databases, Kafka, high-IOPS |
| **pd-extreme** | 120,000 | 2,400 MB/s | SAP HANA, ultra-high IOPS |
| **hyperdisk-balanced** | 160,000 | 2,400 MB/s | Performance-intensive workloads |

### GKE storage classes

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ssd-retain
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-ssd
  replication-type: regional-pd     # sync replication across 2 zones
reclaimPolicy: Retain
allowVolumeExpansion: true
volumeBindingMode: WaitForFirstConsumer
```

!!! tip "Regional Persistent Disks"
    Use **regional-pd** for stateful workloads that need AZ failover without data loss (databases, queues). The disk is synchronously replicated across 2 zones — if the VM fails, rescheduling in the other zone picks up the same disk automatically.

---

## Filestore

Filestore is GCP's managed NFS file storage. A Filestore instance exports one or more NFS shares, mountable from Compute Engine VMs and GKE pods via the Filestore CSI driver.

### Tiers

| Tier | Capacity | Performance | Use case |
|------|---------|------------|---------|
| **Basic HDD** | 1–63 TB | 600 MB/s | Cold shared files |
| **Basic SSD** | 2.5–63 TB | 2.5 GB/s | Shared NFS, content repos |
| **Enterprise** | 1–10 TB | 2.4 GB/s | Mission-critical, CMEK |
| **High Scale** | 10–100 TB | 25 GB/s | ML training datasets |
| **Zonal** | 1–9.75 TB | 800 MB/s | Cost-effective zonal NFS |

```hcl
resource "google_filestore_instance" "shared" {
  name     = "${var.project}-fs"
  location = "${var.region}-a"
  tier     = "BASIC_SSD"

  file_shares {
    capacity_gb = 2560
    name        = "shared"
  }

  networks {
    network      = google_compute_network.main.name
    modes        = ["MODE_IPV4"]
    connect_mode = "PRIVATE_SERVICE_ACCESS"
  }
}
```

---

## Cloud SQL

Cloud SQL is the managed relational database service for MySQL, PostgreSQL and SQL Server on GCP. It handles backups, patching, failover and read replicas automatically.

### Key features

| Feature | Description |
|---------|-------------|
| **High availability** | Synchronous failover to standby in different zone |
| **Read replicas** | Up to 10 replicas, cross-region supported |
| **Point-in-time recovery** | Restore to any second within retention window |
| **Private IP** | VPC peering or Private Service Connect |
| **IAM auth** | Database users backed by GCP IAM — no separate passwords |
| **Connection pooling** | Use Cloud SQL Auth Proxy or pg_bouncer sidecar |

```hcl
resource "google_sql_database_instance" "main" {
  name             = "${var.project}-pg-main"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = "db-n1-standard-4"
    availability_type = "REGIONAL"    # HA with automatic failover

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings { retained_backups = 14 }
    }

    ip_configuration {
      ipv4_enabled                                  = false  # private only
      private_network                               = google_compute_network.main.id
      enable_private_path_for_google_cloud_services = true
    }

    database_flags {
      name  = "max_connections"
      value = "500"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
    }
  }

  deletion_protection = true
}
```

### Cloud SQL Auth Proxy (in GKE)

```yaml
# Sidecar pattern — Cloud SQL Auth Proxy in the pod
containers:
  - name: cloud-sql-proxy
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2
    args:
      - "--structured-logs"
      - "--port=5432"
      - "${PROJECT}:${REGION}:${INSTANCE_NAME}"
    securityContext:
      runAsNonRoot: true
    resources:
      requests: { cpu: 100m, memory: 128Mi }
```

---

## AlloyDB for PostgreSQL

AlloyDB is Google's PostgreSQL-compatible database engineered for demanding OLTP workloads — 4× faster than standard Cloud SQL for PostgreSQL, 100× faster analytical queries.

| Feature | Cloud SQL PostgreSQL | AlloyDB |
|---------|---------------------|---------|
| **Engine** | Vanilla PostgreSQL | Enhanced PostgreSQL |
| **OLTP performance** | Standard | ~4× faster |
| **Analytics** | Standard | Columnar engine (100× faster) |
| **ML** | No | `google_ml_predict()` built-in |
| **HA** | Zonal standby | Multi-node HA (3 zones) |
| **Pricing** | Lower | Higher (~3–4×) |

---

[← GCP Overview](index.md){ .md-button }
[Networking →](networking.md){ .md-button .md-button--primary }
