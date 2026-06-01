---
title: GCP Compute
description: GKE, Compute Engine, Cloud Run, Cloud Functions — compute on Google Cloud Platform.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / compute</span>
    <h1 class="dph-title">GCP Compute</h1>
    <p class="dph-desc">Google invented Kubernetes and runs the world's largest container fleet. GKE is the most capable managed Kubernetes offering, Cloud Run is the fastest path to serverless containers, and Autopilot removes node management entirely.</p>
    <div class="dph-badges">
      <span class="tech-badge">GKE Standard</span>
      <span class="tech-badge">GKE Autopilot</span>
      <span class="tech-badge">Cloud Run</span>
      <span class="tech-badge">Cloud Functions</span>
      <span class="tech-badge">Compute Engine</span>
      <span class="tech-badge">Batch</span>
    </div>
  </div>
</div>

---

## Compute Engine

Compute Engine is GCP's IaaS VM service. Machine types follow the pattern `{family}-{type}-{vcpus}` — e.g., `n2-standard-8`, `c3-highcpu-44`.

### Machine families

| Family | Optimised for | Example |
|--------|-------------|---------|
| **E2** | Cost-efficient, variable performance | `e2-standard-4` |
| **N2 / N2D** | Balanced general-purpose (Intel / AMD) | `n2-standard-8` |
| **C3** | Latest Intel Sapphire Rapids, low latency | `c3-standard-22` |
| **T2D** | AMD EPYC, scale-out compute | `t2d-standard-32` |
| **M3** | Memory-optimised (in-memory DBs) | `m3-ultramem-32` |
| **A2 / A3** | NVIDIA A100 / H100 GPU | `a3-highgpu-8g` |
| **Tau T2A** | ARM Ampere, throughput workloads | `t2a-standard-16` |

!!! tip "Spot VMs"
    GCP Spot VMs (equivalent to AWS Spot) offer 60–91% discount with preemption notice of 30 seconds. Combine with GKE's node auto-provisioning and Spot node pools for stateless, fault-tolerant workloads.

### Managed Instance Groups (MIG)

```hcl
resource "google_compute_instance_template" "app" {
  name_prefix  = "${var.project}-app-"
  machine_type = "n2-standard-4"
  region       = var.region

  disk {
    source_image = "debian-cloud/debian-12"
    auto_delete  = true
    boot         = true
    disk_type    = "pd-ssd"
    disk_size_gb = 50
  }

  network_interface {
    subnetwork = google_compute_subnetwork.app.id
    # no access_config = no external IP (private only)
  }

  service_account {
    email  = google_service_account.app.email
    scopes = ["cloud-platform"]
  }

  lifecycle { create_before_destroy = true }
}

resource "google_compute_region_instance_group_manager" "app" {
  name               = "${var.project}-app-mig"
  region             = var.region
  base_instance_name = "${var.project}-app"

  version { instance_template = google_compute_instance_template.app.id }

  auto_healing_policies {
    health_check      = google_compute_health_check.app.id
    initial_delay_sec = 300
  }
}

resource "google_compute_region_autoscaler" "app" {
  name   = "${var.project}-app-autoscaler"
  region = var.region
  target = google_compute_region_instance_group_manager.app.id

  autoscaling_policy {
    max_replicas    = 20
    min_replicas    = 2
    cooldown_period = 60
    cpu_utilization { target = 0.70 }
  }
}
```

---

## GKE — Google Kubernetes Engine

GKE is the gold standard for managed Kubernetes. The control plane is fully managed, regional (3-AZ control plane), upgradeable in-place and integrated with all GCP IAM, networking and observability services.

### GKE Standard vs Autopilot

| Aspect | Standard | Autopilot |
|--------|---------|-----------|
| **Node management** | You manage node pools | Google manages nodes |
| **Cost model** | Per node (VM billing) | Per pod (vCPU + memory) |
| **Customisation** | Full control (node taints, labels, machine type) | Restricted (Google-defined node classes) |
| **Scaling** | Cluster autoscaler + node auto-provisioning | Automatic |
| **Security** | You configure pod security | Hardened by default (no privileged pods) |
| **Best for** | Custom ML, privileged workloads, cost-tuning | Standard web services, microservices |

```hcl
resource "google_container_cluster" "main" {
  name     = "${var.project}-gke"
  location = var.region   # regional cluster = 3-AZ control plane

  # Separate node pool management
  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.main.name
  subnetwork = google_compute_subnetwork.gke.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  workload_identity_config {
    workload_pool = "${data.google_project.current.project_id}.svc.id.goog"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  release_channel { channel = "REGULAR" }

  addons_config {
    http_load_balancing { disabled = false }
    horizontal_pod_autoscaling { disabled = false }
    gce_persistent_disk_csi_driver_config { enabled = true }
    gcp_filestore_csi_driver_config { enabled = true }
  }

  maintenance_policy {
    recurring_window {
      start_time = "2024-01-01T02:00:00Z"
      end_time   = "2024-01-01T06:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=SA"
    }
  }
}

resource "google_container_node_pool" "app" {
  name     = "app"
  location = var.region
  cluster  = google_container_cluster.main.name

  initial_node_count = 1

  autoscaling {
    min_node_count  = 1
    max_node_count  = 10
    location_policy = "BALANCED"
  }

  node_config {
    machine_type = "n2-standard-4"
    disk_type    = "pd-ssd"
    disk_size_gb = 100
    image_type   = "COS_CONTAINERD"

    workload_metadata_config { mode = "GKE_METADATA" }

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}
```

### Workload Identity for pods

Workload Identity binds a Kubernetes ServiceAccount to a GCP Service Account — pods get GCP credentials via a projected volume token without needing key files.

```hcl
# GCP Service Account for the application
resource "google_service_account" "app" {
  account_id   = "${var.project}-app"
  display_name = "Application service account"
}

# Allow the K8s ServiceAccount to impersonate the GCP SA
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.app.id
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${data.google_project.current.project_id}.svc.id.goog[${var.namespace}/${var.k8s_service_account}]"
}
```

---

## Cloud Run

Cloud Run is Google's serverless container platform. A container image is all that's required — no cluster, no node management. Cloud Run scales from zero to thousands of instances in seconds.

```hcl
resource "google_cloud_run_v2_service" "api" {
  name     = "api"
  location = var.region

  template {
    service_account = google_service_account.app.email

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repo}/api:latest"

      resources {
        limits = { cpu = "1000m"; memory = "512Mi" }
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_password.secret_id
            version = "latest"
          }
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 100
    }
  }
}

# Allow public access (no auth required)
resource "google_cloud_run_service_iam_member" "public" {
  service  = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

!!! tip "Cloud Run vs Cloud Run for Anthos"
    Standard **Cloud Run** (managed) is fully serverless — Google manages all infrastructure. **Cloud Run for Anthos** (now Cloud Run on GKE) runs on your GKE cluster — gives you VPC-native networking and GPU access at the cost of managing node pools.

---

## Cloud Functions (2nd gen)

Cloud Functions gen2 is built on Cloud Run — each function runs as a Cloud Run service under the hood, giving it all Cloud Run capabilities: longer timeout (60 min), larger memory (32 GB), concurrency per instance.

```python
# main.py — HTTP trigger (Python 3.12)
import functions_framework
from google.cloud import storage

@functions_framework.http
def process_upload(request):
    data = request.get_json()
    bucket_name = data["bucket"]
    blob_name   = data["name"]

    client = storage.Client()
    blob   = client.bucket(bucket_name).blob(blob_name)
    content = blob.download_as_text()

    # process content...
    return {"processed": blob_name}, 200
```

```hcl
resource "google_cloudfunctions2_function" "processor" {
  name     = "upload-processor"
  location = var.region

  build_config {
    runtime     = "python312"
    entry_point = "process_upload"
    source {
      storage_source {
        bucket = google_storage_bucket.functions.name
        object = google_storage_bucket_object.source.name
      }
    }
  }

  service_config {
    max_instance_count    = 50
    available_memory      = "512M"
    timeout_seconds       = 300
    service_account_email = google_service_account.functions.email
    environment_variables = { LOG_LEVEL = "INFO" }
  }
}
```

---

[← GCP Overview](index.md){ .md-button }
[Storage →](storage.md){ .md-button .md-button--primary }
