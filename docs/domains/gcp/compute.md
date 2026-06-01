---
title: GCP Computação
description: GKE, Compute Engine, Cloud Run, Cloud Functions — computação na Google Cloud Platform.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / compute</span>
    <h1 class="dph-title">GCP Computação</h1>
    <p class="dph-desc">O Google inventou o Kubernetes e opera a maior frota de contêineres do mundo. GKE é a oferta de Kubernetes gerenciado mais capaz, Cloud Run é o caminho mais rápido para contêineres serverless, e Autopilot elimina completamente o gerenciamento de nós.</p>
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

Compute Engine é o serviço de VMs IaaS do GCP. Os tipos de máquina seguem o padrão `{família}-{tipo}-{vcpus}` — por exemplo, `n2-standard-8`, `c3-highcpu-44`.

### Famílias de máquinas

| Família | Otimizado para | Exemplo |
|---------|---------------|---------|
| **E2** | Custo eficiente, desempenho variável | `e2-standard-4` |
| **N2 / N2D** | Uso geral balanceado (Intel / AMD) | `n2-standard-8` |
| **C3** | Intel Sapphire Rapids mais recente, baixa latência | `c3-standard-22` |
| **T2D** | AMD EPYC, computação de expansão horizontal | `t2d-standard-32` |
| **M3** | Otimizado para memória (BDs em memória) | `m3-ultramem-32` |
| **A2 / A3** | GPU NVIDIA A100 / H100 | `a3-highgpu-8g` |
| **Tau T2A** | ARM Ampere, cargas de trabalho de throughput | `t2a-standard-16` |

!!! tip "Spot VMs"
    GCP Spot VMs (equivalente às Spot da AWS) oferecem 60–91% de desconto com aviso de preempção de 30 segundos. Combine com o aprovisionamento automático de nós do GKE e pools de nós Spot para cargas de trabalho sem estado e tolerantes a falhas.

### Grupos de Instâncias Gerenciadas (MIG)

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

GKE é o padrão ouro para Kubernetes gerenciado. O plano de controle é totalmente gerenciado, regional (plano de controle em 3 AZs), atualizável in-place e integrado a todos os serviços de IAM, rede e observabilidade do GCP.

### GKE Standard vs Autopilot

| Aspecto | Standard | Autopilot |
|---------|----------|-----------|
| **Gerenciamento de nós** | Você gerencia os pools de nós | Google gerencia os nós |
| **Modelo de custo** | Por nó (cobrança de VM) | Por pod (vCPU + memória) |
| **Personalização** | Controle total (taints, labels, tipo de máquina) | Restrito (classes de nós definidas pelo Google) |
| **Escalabilidade** | Cluster autoscaler + aprovisionamento automático de nós | Automática |
| **Segurança** | Você configura a segurança dos pods | Reforçada por padrão (sem pods privilegiados) |
| **Melhor para** | ML customizado, cargas privilegiadas, ajuste de custo | Serviços web padrão, microsserviços |

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

### Workload Identity para pods

O Workload Identity vincula uma ServiceAccount do Kubernetes a uma Service Account do GCP — os pods obtêm credenciais do GCP via token de volume projetado sem precisar de arquivos de chave.

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

Cloud Run é a plataforma de contêineres serverless do Google. Apenas uma imagem de contêiner é necessária — sem cluster, sem gerenciamento de nós. Cloud Run escala de zero a milhares de instâncias em segundos.

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
    O **Cloud Run** padrão (gerenciado) é totalmente serverless — o Google gerencia toda a infraestrutura. O **Cloud Run for Anthos** (agora Cloud Run no GKE) roda no seu cluster GKE — oferece rede nativa de VPC e acesso a GPU ao custo de gerenciar pools de nós.

---

## Cloud Functions (2ª geração)

Cloud Functions gen2 é construído sobre o Cloud Run — cada função roda como um serviço Cloud Run por baixo dos panos, conferindo todas as capacidades do Cloud Run: timeout maior (60 min), mais memória (32 GB), concorrência por instância.

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

[← Visão Geral GCP](index.md){ .md-button }
[Armazenamento →](storage.md){ .md-button .md-button--primary }
