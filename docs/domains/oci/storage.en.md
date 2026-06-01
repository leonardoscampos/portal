---
title: OCI Storage
description: Object Storage, Block Volumes, File Storage, Archive Storage — storage on Oracle Cloud Infrastructure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / storage</span>
    <h1 class="dph-title">OCI Storage</h1>
    <p class="dph-desc">OCI Object Storage offers an S3-compatible API and is the standard location for Terraform state, artefacts and data. Block Volumes deliver ultra-high IOPS at predictable pricing. File Storage provides NFS v3/v4.1 shared mounts for clusters.</p>
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

OCI Object Storage is regionally durable, S3-compatible object storage. It is used for Terraform remote state, build artefacts, container image layers (OCIR), data lake ingestion and backup targets.

### Storage tiers

| Tier | Description | Min retention | Use case |
|------|-------------|--------------|---------|
| **Standard** | Hot, frequently accessed | None | Artefacts, state files, active data |
| **Infrequent Access** | Lower storage cost, higher retrieval | 31 days | Backups, logs |
| **Archive** | Lowest cost, restore required before read | 90 days | Long-term compliance |

### S3 compatibility

OCI Object Storage exposes an Amazon S3-compatible endpoint. Most S3 tools (AWS CLI, Terraform S3 backend, s3fs, rclone) work natively with OCI Object Storage:

```
Endpoint: https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
```

### Terraform state bucket

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

### Terraform backend (S3-compatible)

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

### Lifecycle policy

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
    Use **Pre-Authenticated Requests (PARs)** to grant time-limited, credential-free access to specific objects or buckets — useful for sharing artefacts with external partners without exposing IAM credentials.

---

## Block Volumes

OCI Block Volumes are high-performance block storage attached to Compute instances and OKE persistent volumes. Block Volumes are automatically replicated across 3 fault domains within an Availability Domain.

### Performance tiers

| Tier | IOPS/GB | Max IOPS | Max throughput | Use case |
|------|--------|---------|---------------|---------|
| **Lower Cost** | 2 | 3,000 | 480 MB/s | Dev/test |
| **Balanced** | 10 | 25,000 | 480 MB/s | General workloads |
| **Higher Performance** | 20 | 35,000 | 480 MB/s | Databases |
| **Ultra-High Performance** | 30–120 | 300,000 | 2,680 MB/s | Mission-critical DBs |

!!! tip "Ultra-High Performance"
    OCI's **Ultra-High Performance** tier supports up to 300,000 IOPS and 2,680 MB/s throughput — significantly more than comparable offerings from AWS (EBS io2) or Azure (Ultra Disk) at the same price point.

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

### OKE storage classes

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

### Volume Backup

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

OCI File Storage provides a fully managed NFS v3 and NFSv4.1 shared file system. Mount targets expose the NFS endpoint within a VCN subnet; file systems can be mounted from multiple Compute instances and OKE pods simultaneously.

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

### Mount in OKE pods

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

OCI Archive Storage is the lowest-cost storage tier within Object Storage — 10× cheaper than Standard. Objects must be restored (takes up to 1 hour) before they can be downloaded.

Use cases: regulatory compliance archives, final backup copies, cold disaster recovery data.

| Attribute | Details |
|-----------|---------|
| Minimum retention | 90 days |
| Restoration time | Up to 1 hour |
| Pricing | ~$0.001/GB/month (region-dependent) |
| Access | Via Object Storage API after restoration |

---

[← OCI Overview](index.md){ .md-button }
[Networking →](networking.md){ .md-button .md-button--primary }
