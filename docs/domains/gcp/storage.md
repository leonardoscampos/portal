---
title: GCP Armazenamento
description: Cloud Storage, Persistent Disk, Filestore, Cloud SQL, AlloyDB — armazenamento no Google Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / storage</span>
    <h1 class="dph-title">GCP Armazenamento</h1>
    <p class="dph-desc">Cloud Storage (GCS) é a espinha dorsal — objetos, artefatos, estado do Terraform, data lake. Persistent Disk para armazenamento em bloco de VMs e GKE. Filestore para NFS compartilhado. Cloud SQL e AlloyDB para bancos de dados relacionais gerenciados.</p>
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

GCS é o armazenamento de objetos do GCP — nomes de buckets globalmente únicos, namespace plano, consistência eventual substituída por consistência forte em 2021. É o backend do Terraform, cache de build de contêineres, repositório de artefatos e fundação de data lake para a maioria das cargas de trabalho do GCP.

### Classes de armazenamento

| Classe | Armazenamento mínimo | Acesso | Caso de uso |
|--------|---------------------|--------|-------------|
| **Standard** | Nenhum | Imediato | Dados quentes, acesso frequente |
| **Nearline** | 30 dias | Imediato | Acesso mensal, backups |
| **Coldline** | 90 dias | Imediato | Acesso trimestral, DR |
| **Archive** | 365 dias | Imediato (custo de egresso maior) | Retenção de 7+ anos, conformidade |

### Bucket de estado do Terraform

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

### Configuração do backend GCS

```hcl
terraform {
  backend "gcs" {
    bucket = "my-project-tfstate"
    prefix = "prod/us-central1/gke"
  }
}
```

### Gerenciamento de ciclo de vida

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

!!! tip "Acesso uniforme no nível do bucket"
    Sempre habilite `uniform_bucket_level_access`. Isso desativa as ACLs legadas no nível de objeto e aplica controle de acesso exclusivamente via IAM — mais simples de auditar e gerenciar em escala.

---

## Persistent Disk

Persistent Disk (PD) é o armazenamento em bloco do GCP para VMs do Compute Engine e volumes persistentes do GKE. Ao contrário do AWS EBS, o PD pode ser montado como **somente leitura em múltiplas VMs simultaneamente**.

### Tipos de disco

| Tipo | IOPS máximo | Throughput máximo | Caso de uso |
|------|------------|-------------------|-------------|
| **pd-standard** | 3.000 | 180 MB/s | Dev/test, dados frios |
| **pd-balanced** | 15.000 | 240 MB/s | Cargas de trabalho gerais |
| **pd-ssd** | 60.000 | 1.200 MB/s | Bancos de dados, Kafka, alto IOPS |
| **pd-extreme** | 120.000 | 2.400 MB/s | SAP HANA, IOPS ultraelevado |
| **hyperdisk-balanced** | 160.000 | 2.400 MB/s | Cargas de trabalho de alto desempenho |

### Classes de armazenamento do GKE

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

!!! tip "Persistent Disks Regionais"
    Use **regional-pd** para cargas de trabalho com estado que precisam de failover entre AZs sem perda de dados (bancos de dados, filas). O disco é replicado de forma síncrona em 2 zonas — se a VM falhar, o reagendamento na outra zona retoma o mesmo disco automaticamente.

---

## Filestore

Filestore é o armazenamento de arquivos NFS gerenciado do GCP. Uma instância do Filestore exporta um ou mais compartilhamentos NFS, montáveis a partir de VMs do Compute Engine e pods GKE via driver CSI do Filestore.

### Níveis

| Nível | Capacidade | Desempenho | Caso de uso |
|-------|-----------|-----------|-------------|
| **Basic HDD** | 1–63 TB | 600 MB/s | Arquivos compartilhados frios |
| **Basic SSD** | 2,5–63 TB | 2,5 GB/s | NFS compartilhado, repositórios de conteúdo |
| **Enterprise** | 1–10 TB | 2,4 GB/s | Missão crítica, CMEK |
| **High Scale** | 10–100 TB | 25 GB/s | Datasets de treinamento de ML |
| **Zonal** | 1–9,75 TB | 800 MB/s | NFS zonal econômico |

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

Cloud SQL é o serviço de banco de dados relacional gerenciado para MySQL, PostgreSQL e SQL Server no GCP. Ele lida com backups, patches, failover e réplicas de leitura automaticamente.

### Principais recursos

| Recurso | Descrição |
|---------|-----------|
| **Alta disponibilidade** | Failover síncrono para standby em zona diferente |
| **Réplicas de leitura** | Até 10 réplicas, cross-region suportado |
| **Recuperação para um ponto no tempo** | Restauração para qualquer segundo dentro da janela de retenção |
| **IP privado** | VPC peering ou Private Service Connect |
| **Autenticação IAM** | Usuários de banco de dados suportados pelo IAM do GCP — sem senhas separadas |
| **Pool de conexões** | Use Cloud SQL Auth Proxy ou sidecar pg_bouncer |

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

### Cloud SQL Auth Proxy (no GKE)

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

AlloyDB é o banco de dados compatível com PostgreSQL do Google, projetado para cargas OLTP exigentes — 4× mais rápido que o Cloud SQL para PostgreSQL padrão, 100× mais rápido em consultas analíticas.

| Recurso | Cloud SQL PostgreSQL | AlloyDB |
|---------|---------------------|---------|
| **Engine** | PostgreSQL padrão | PostgreSQL aprimorado |
| **Desempenho OLTP** | Padrão | ~4× mais rápido |
| **Análises** | Padrão | Engine colunar (100× mais rápido) |
| **ML** | Não | `google_ml_predict()` integrado |
| **HA** | Standby zonal | HA multi-nó (3 zonas) |
| **Preço** | Menor | Maior (~3–4×) |

---

[← Visão Geral GCP](index.md){ .md-button }
[Rede →](networking.md){ .md-button .md-button--primary }
