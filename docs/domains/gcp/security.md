---
title: GCP Segurança & IAM
description: Cloud IAM, Workload Identity, Secret Manager, Cloud KMS, Security Command Center, VPC Service Controls — segurança e IAM no Google Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / security</span>
    <h1 class="dph-title">GCP Segurança &amp; IAM</h1>
    <p class="dph-desc">O Cloud IAM usa vínculos (quem, papel, onde) em cada nível da hierarquia de recursos. Workload Identity elimina arquivos de chave para pods GKE. Secret Manager centraliza segredos. Cloud KMS gerencia CMEK. Security Command Center fornece gestão de postura na nuvem.</p>
    <div class="dph-badges">
      <span class="tech-badge">Cloud IAM</span>
      <span class="tech-badge">Workload Identity</span>
      <span class="tech-badge">Secret Manager</span>
      <span class="tech-badge">Cloud KMS</span>
      <span class="tech-badge">SCC</span>
      <span class="tech-badge">VPC Service Controls</span>
    </div>
  </div>
</div>

---

## Cloud IAM

O Cloud IAM é baseado em **vínculos**: uma tupla de `(principal, papel, recurso)`. Os principais podem ser contas do Google, contas de serviço, grupos, domínios ou identificadores especiais como `allAuthenticatedUsers`.

### Hierarquia de recursos

```
Organisation
  └── Folder (optional — business unit, environment)
        └── Project
              └── Resources (GCS bucket, GKE cluster, VM, etc.)
```

As políticas do IAM são **herdadas para baixo e aditivas** — papéis concedidos no nível da organização se aplicam a todos os projetos. Não há negação explícita (exceto com as **políticas de negação do IAM**, que são negações aditivas avaliadas antes das políticas de permissão).

### Tipos de papel

| Tipo | Descrição | Exemplo |
|------|-----------|---------|
| **Básico** | Papéis legados amplos | `roles/viewer`, `roles/editor`, `roles/owner` |
| **Pré-definido** | Papéis selecionados por serviço | `roles/container.developer` |
| **Personalizado** | Conjunto de permissões definido pela organização | `CustomRole/ciDeploy` |

```hcl
# Grant a CI service account permission to push to Artifact Registry
resource "google_project_iam_member" "ci_push" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# Grant GKE developer access — cluster-scoped Kubernetes RBAC is set separately
resource "google_project_iam_member" "gke_developer" {
  project = var.project_id
  role    = "roles/container.developer"
  member  = "group:developers@mycompany.com"
}
```

!!! tip "Princípio do menor privilégio"
    Nunca use `roles/editor` ou `roles/owner` em produção. Audite todos os vínculos com `gcloud projects get-iam-policy` ou o **Policy Analyzer** no Security Command Center. Use o **IAM Recommender** para identificar automaticamente contas de serviço com excesso de privilégios.

---

## Workload Identity

O Workload Identity permite que pods GKE atuem como contas de serviço do GCP sem montar arquivos de chave. O token OIDC projetado no pod é trocado por um token de acesso GCP de curta duração via Security Token Service (STS).

```hcl
# 1. GCP Service Account for the application
resource "google_service_account" "app" {
  account_id   = "${var.project}-app"
  project      = var.project_id
}

# 2. Allow the Kubernetes ServiceAccount to impersonate the GCP SA
resource "google_service_account_iam_member" "workload_identity" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.workloadIdentityUser"
  member = "serviceAccount:${var.project_id}.svc.id.goog[${var.namespace}/${var.k8s_sa_name}]"
}

# 3. Grant the GCP SA required permissions (e.g., Secret Manager access)
resource "google_project_iam_member" "app_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.app.email}"
}
```

```yaml
# 4. Annotate the Kubernetes ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app
  namespace: production
  annotations:
    iam.gke.io/gcp-service-account: app@my-project.iam.gserviceaccount.com
```

---

## Secret Manager

O Cloud Secret Manager armazena, versiona e audita segredos. O acesso é controlado via IAM (`roles/secretmanager.secretAccessor`). Cada acesso é registrado no Cloud Audit Logs.

```hcl
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
  project   = var.project_id

  replication {
    auto {}   # automatic multi-region replication
  }

  labels = { env = var.env }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password   # use Vault, SOPS or CI secret to source this
}

# Allow the app service account to read the secret
resource "google_secret_manager_secret_iam_member" "app" {
  secret_id = google_secret_manager_secret.db_password.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}
```

### Montar no GKE via Secrets Store CSI Driver

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: gcp-secrets
spec:
  provider: gcp
  parameters:
    secrets: |
      - resourceName: projects/my-project/secrets/db-password/versions/latest
        path: db-password
  secretObjects:
    - secretName: app-secrets
      type: Opaque
      data:
        - objectName: db-password
          key: DB_PASSWORD
```

---

## Cloud KMS

O Cloud KMS gerencia chaves criptográficas para criptografia em envelope de recursos GCP (CMEK). As chaves existem em um **chaveiro** dentro de uma localização; chaveiros e chaves não podem ser excluídos.

```hcl
resource "google_kms_key_ring" "main" {
  name     = "${var.project}-kr"
  location = "us"   # global, or a specific region for data residency
  project  = var.project_id
}

resource "google_kms_crypto_key" "gke_secrets" {
  name            = "gke-secrets-key"
  key_ring        = google_kms_key_ring.main.id
  rotation_period = "7776000s"  # 90 days
  purpose         = "ENCRYPT_DECRYPT"

  lifecycle { prevent_destroy = true }
}

# Allow GKE to use the key for application-layer secret encryption
resource "google_kms_crypto_key_iam_member" "gke" {
  crypto_key_id = google_kms_crypto_key.gke_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${data.google_project.current.number}@container-engine-robot.iam.gserviceaccount.com"
}

# Enable application-layer encryption for GKE secrets
resource "google_container_cluster" "main" {
  # ...
  database_encryption {
    state    = "ENCRYPTED"
    key_name = google_kms_crypto_key.gke_secrets.id
  }
}
```

---

## Security Command Center (SCC)

O SCC é a plataforma CSPM (Gestão de Postura de Segurança na Nuvem) do GCP. Ela agrega descobertas de detectores construídos pelo Google e integrações de terceiros, mapeia para frameworks (CIS, PCI-DSS, NIST) e fornece inventário de ativos.

### Principais detectores integrados

| Detector | O que detecta |
|---------|--------------|
| **Security Health Analytics** | Configurações incorretas (buckets públicos, Firewall aberto para 0.0.0.0, sem OS login) |
| **Event Threat Detection** | Credenciais IAM comprometidas, mineração de criptomoedas, força bruta, atividade de API incomum |
| **Container Threat Detection** | Ameaças em tempo de execução no GKE — shells reversos, execução de binários em contêiner |
| **Web Security Scanner** | XSS, SQLi, conteúdo misto em apps App Engine / Cloud Run |
| **VM Threat Detection** | Ameaças no nível de memória, rootkits (sem agente) |

```hcl
# Enable SCC at organisation level
resource "google_scc_organization_custom_module" "deny_public_buckets" {
  organization    = data.google_organization.main.org_id
  display_name    = "Deny public GCS buckets"
  enablement_state = "ENABLED"
  module_type     = "CUSTOM_MODULE"
  custom_config {
    predicate {
      expression = "resource.type == 'storage.googleapis.com/Bucket' && resource.data.iamConfiguration.publicAccessPrevention != 'enforced'"
    }
    custom_output {}
    resource_selector {
      resource_types = ["storage.googleapis.com/Bucket"]
    }
    severity    = "HIGH"
    description = "GCS bucket has public access prevention disabled"
  }
}
```

---

## VPC Service Controls

O VPC Service Controls (VPC-SC) cria um perímetro de segurança em torno das APIs do GCP. Os recursos dentro do perímetro só podem se comunicar com outros recursos dentro do perímetro — prevenindo exfiltração de dados mesmo se as credenciais forem comprometidas.

```hcl
resource "google_access_context_manager_access_policy" "main" {
  parent = "organizations/${var.org_id}"
  title  = "Main Access Policy"
}

resource "google_access_context_manager_service_perimeter" "data" {
  parent = "accessPolicies/${google_access_context_manager_access_policy.main.name}"
  name   = "accessPolicies/${google_access_context_manager_access_policy.main.name}/servicePerimeters/data-perimeter"
  title  = "Data Perimeter"

  status {
    resources = [
      "projects/${data.google_project.data.number}"
    ]
    restricted_services = [
      "storage.googleapis.com",
      "bigquery.googleapis.com",
      "secretmanager.googleapis.com",
    ]
    access_levels = [
      google_access_context_manager_access_level.corp_network.name
    ]
  }
}
```

!!! warning "Modo dry-run primeiro"
    Sempre implante o VPC-SC no **modo dry-run** (`use_explicit_dry_run_spec = true`) antes de aplicar. As violações são registradas, mas não bloqueadas — oferece visibilidade sobre o que quebraria antes da aplicação.

---

[← Visão Geral GCP](index.md){ .md-button }
[Observabilidade →](observability.md){ .md-button .md-button--primary }
