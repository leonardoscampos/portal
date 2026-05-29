---
title: AWS Storage
description: S3, EBS, EFS, FSx — object, block and file storage on AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / storage</span>
    <h1 class="dph-title">AWS Storage</h1>
    <p class="dph-desc">Object storage at infinite scale, block storage for databases, managed file systems for shared workloads — the full AWS storage stack mapped to real-world DevOps patterns.</p>
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

S3 is the backbone of AWS storage. Eleven nines of durability, unlimited capacity, S3-compatible API, native event notifications and lifecycle automation make it the default choice for artefacts, backups, data lakes and static assets.

### Storage classes

| Class | Retrieval | Min duration | Best for |
|-------|----------|-------------|---------|
| **Standard** | Immediate | None | Frequently accessed data |
| **Standard-IA** | Immediate | 30 days | Backups, DR replicas |
| **One Zone-IA** | Immediate | 30 days | Re-creatable data, lower-cost IA |
| **Intelligent-Tiering** | Immediate / minutes / hours | None | Unknown or changing access patterns |
| **Glacier Instant** | Immediate | 90 days | Archives accessed a few times/year |
| **Glacier Flexible** | Minutes – hours | 90 days | Long-term backups |
| **Glacier Deep Archive** | 12–48 hours | 180 days | Compliance, 7+ year retention |

### Encryption

All new S3 buckets encrypt objects by default using **SSE-S3** (AES-256, AWS-managed keys). Switch to **SSE-KMS** when you need customer-managed CMKs, key rotation audit trails, or cross-account access control.

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
    bucket_key_enabled = true  # reduces KMS request costs by ~99%
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
    Always enable `bucket_key_enabled = true` on SSE-KMS buckets. It generates a short-lived data key cached at the bucket level, reducing KMS API calls (and costs) by up to 99% for buckets with many small objects.

### Event notifications

S3 events (ObjectCreated, ObjectRemoved, etc.) can fan out to Lambda, SQS, SNS or EventBridge. Prefer **EventBridge** for fine-grained filtering and routing to multiple targets without extra Lambda functions.

```hcl
resource "aws_s3_bucket_notification" "uploads" {
  bucket      = aws_s3_bucket.uploads.id
  eventbridge = true  # route all events to EventBridge default bus
}
```

---

## EBS — Elastic Block Store

EBS provides persistent block volumes attached to EC2 instances. Volumes live in a single AZ and are automatically replicated within that AZ.

### Volume types

| Type | IOPS | Throughput | Use case |
|------|------|-----------|---------|
| **gp3** (default) | 3,000–16,000 | 125–1,000 MB/s | General purpose, boot volumes, Kubernetes PVs |
| **gp2** (legacy) | 3 IOPS/GB, up to 16,000 | Burstable | Legacy; migrate to gp3 |
| **io2 / io2 Block Express** | up to 256,000 | up to 4,000 MB/s | High-performance databases (Oracle, SQL Server) |
| **st1** (HDD) | 500 | 500 MB/s | Throughput-heavy sequential: Kafka, log storage |
| **sc1** (HDD cold) | 250 | 250 MB/s | Cold data, lowest cost per GB |

!!! note "gp3 vs gp2"
    **Always use gp3**. It is cheaper than gp2 at the same size, and IOPS/throughput are configured independently of disk size — no need to over-provision size just to get IOPS.

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

### Snapshots & automation

EBS Snapshots are incremental and stored in S3 (managed by AWS). Use **Amazon Data Lifecycle Manager (DLM)** for automated snapshot schedules and retention policies. Cross-region copy for DR.

```hcl
resource "aws_dlm_lifecycle_policy" "daily_snapshot" {
  description        = "Daily EBS snapshot — 14-day retention"
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

EFS is a managed NFS (NFSv4) file system that scales automatically and is accessible from multiple EC2 instances, ECS tasks or EKS pods simultaneously — in the same AZ or across multiple AZs.

### Performance & throughput modes

| Mode | Description |
|------|-------------|
| **General Purpose** (default) | Lowest latency; suitable for most workloads |
| **Max I/O** | Higher aggregate throughput at higher latency; legacy, use only for HPC |
| **Elastic throughput** (default) | Scales automatically to workload; best for spiky access patterns |
| **Provisioned throughput** | Fixed MiB/s regardless of storage size; for sustained high throughput |
| **Bursting throughput** | Throughput scales with storage size + burst credits; predictable workloads |

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

### EFS in Kubernetes

Mount EFS volumes in EKS pods via the **EFS CSI driver** (`aws-efs-csi-driver` add-on). Use `accessModes: ReadWriteMany` for shared mounts across pods.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: efs-sc
provisioner: efs.csi.aws.com
parameters:
  provisioningMode: efs-ap        # uses EFS Access Points
  fileSystemId: fs-0123456789abcdef
  directoryPerms: "700"
```

---

## FSx — Managed File Systems

FSx offers managed file systems for specialised workloads where EFS (NFS) is insufficient.

| Variant | Protocol | Best for |
|---------|---------|---------|
| **FSx for Lustre** | Lustre | HPC, ML training, parallel I/O; can link to S3 |
| **FSx for Windows** | SMB / NFS | Windows workloads, Active Directory integration |
| **FSx for NetApp ONTAP** | NFS / SMB / iSCSI | Enterprise NAS, SnapMirror replication, multi-protocol |
| **FSx for OpenZFS** | NFS | ZFS snapshots, clones; lift-and-shift from on-prem ZFS |

!!! example "FSx for Lustre ↔ S3"
    FSx for Lustre can be linked to an S3 bucket as a data repository. Files are lazily loaded from S3 on first access and can be exported back — ideal for ML pipelines where training data lives in S3 but needs POSIX high-throughput access.

---

## Glacier & Archive

S3 Glacier is not a separate service — it is accessed via **S3 storage classes**. Use lifecycle rules to transition objects to the appropriate Glacier tier.

| Tier | First-byte latency | Typical cost |
|------|--------------------|-------------|
| Glacier Instant Retrieval | Milliseconds | ~$0.004/GB/month |
| Glacier Flexible Retrieval | 1–5 min (Expedited), 3–5 hr (Standard), 5–12 hr (Bulk) | ~$0.0036/GB/month |
| Glacier Deep Archive | 12 hr (Standard), 48 hr (Bulk) | ~$0.00099/GB/month |

!!! tip "Vault Lock for compliance"
    Use **S3 Object Lock** in compliance mode (WORM) to prevent deletion or overwrite for a fixed retention period. Required for SEC 17a-4, CFTC 1.31 and similar regulations.

---

[← Compute](compute.md){ .md-button }
[Networking →](networking.md){ .md-button .md-button--primary }
