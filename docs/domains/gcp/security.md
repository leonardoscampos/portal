---
title: GCP Security & IAM
description: Cloud IAM, Workload Identity, Secret Manager, Cloud KMS, Security Command Center, VPC Service Controls.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / security</span>
    <h1 class="dph-title">GCP Security &amp; IAM</h1>
    <p class="dph-desc">GCP IAM uses bindings (who, role, where) at every level of the resource hierarchy. Workload Identity eliminates key files for GKE pods. Secret Manager centralises secrets. Cloud KMS handles CMEK. Security Command Center provides cloud posture management.</p>
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

GCP IAM is based on **bindings**: a tuple of `(principal, role, resource)`. Principals can be Google accounts, service accounts, groups, domains or special identifiers like `allAuthenticatedUsers`.

### Resource hierarchy

```
Organisation
  └── Folder (optional — business unit, environment)
        └── Project
              └── Resources (GCS bucket, GKE cluster, VM, etc.)
```

IAM policies are **inherited downward and additive** — roles granted at the org level apply to all projects. There is no explicit deny (except with **IAM Deny policies**, which are additive denies evaluated before allow policies).

### Role types

| Type | Description | Example |
|------|-------------|---------|
| **Basic** | Broad legacy roles | `roles/viewer`, `roles/editor`, `roles/owner` |
| **Predefined** | Service-specific curated roles | `roles/container.developer` |
| **Custom** | Organisation-defined set of permissions | `CustomRole/ciDeploy` |

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

!!! tip "Principle of least privilege"
    Never use `roles/editor` or `roles/owner` in production. Audit all bindings with `gcloud projects get-iam-policy` or **Policy Analyzer** in Security Command Center. Use **IAM Recommender** to surface over-privileged service accounts automatically.

---

## Workload Identity

Workload Identity lets GKE pods act as GCP Service Accounts without mounting key files. The OIDC token projected into the pod is exchanged for a short-lived GCP access token via the Security Token Service (STS).

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

Cloud Secret Manager stores, versions and audits secrets. Access is controlled via IAM (`roles/secretmanager.secretAccessor`). Each access is logged to Cloud Audit Logs.

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

### Mount in GKE via Secrets Store CSI Driver

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

Cloud KMS manages cryptographic keys for envelope encryption of GCP resources (CMEK). Keys exist in a **key ring** within a location; key rings and keys cannot be deleted.

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

SCC is GCP's CSPM (Cloud Security Posture Management) platform. It aggregates findings from Google-built detectors and third-party integrations, maps to frameworks (CIS, PCI-DSS, NIST) and provides asset inventory.

### Key built-in detectors

| Detector | What it finds |
|---------|--------------|
| **Security Health Analytics** | Misconfigurations (public buckets, firewall open to 0.0.0.0, no OS login) |
| **Event Threat Detection** | Compromised IAM credentials, cryptomining, brute force, unusual API activity |
| **Container Threat Detection** | Runtime threats in GKE — reverse shells, binary execution in container |
| **Web Security Scanner** | XSS, SQLi, mixed content in App Engine / Cloud Run apps |
| **VM Threat Detection** | Memory-level threats, rootkits (agentless) |

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

VPC Service Controls (VPC-SC) creates a security perimeter around GCP APIs. Resources inside the perimeter can only communicate with other resources inside the perimeter — preventing data exfiltration even if credentials are compromised.

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

!!! warning "Dry-run mode first"
    Always deploy VPC-SC in **dry-run mode** (`use_explicit_dry_run_spec = true`) before enforcing. Violations are logged but not blocked — gives you visibility into what would break before enforcement.

---

[← GCP Overview](index.md){ .md-button }
[Observability →](observability.md){ .md-button .md-button--primary }
