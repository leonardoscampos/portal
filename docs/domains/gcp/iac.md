---
title: GCP IaC & DevOps
description: Terraform, Config Connector, Cloud Build, Artifact Registry, Cloud Deploy, Config Sync — IaC on GCP.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / iac</span>
    <h1 class="dph-title">GCP IaC &amp; DevOps</h1>
    <p class="dph-desc">The Terraform Google provider is mature and comprehensive. Config Connector bridges GCP resources into the Kubernetes API. Cloud Build provides native GCP CI. Cloud Deploy handles progressive delivery to GKE. Config Sync (ACM) closes the GitOps loop.</p>
    <div class="dph-badges">
      <span class="tech-badge">Terraform</span>
      <span class="tech-badge">Config Connector</span>
      <span class="tech-badge">Cloud Build</span>
      <span class="tech-badge">Artifact Registry</span>
      <span class="tech-badge">Cloud Deploy</span>
      <span class="tech-badge">Config Sync</span>
    </div>
  </div>
</div>

---

## Terraform — Google Provider

The `hashicorp/google` provider is the primary IaC tool for GCP. Remote state lives in a GCS bucket with built-in locking (no DynamoDB equivalent needed).

### Bootstrap remote state

```bash
# Bootstrap script
PROJECT_ID="my-project"
BUCKET_NAME="${PROJECT_ID}-tfstate"
REGION="us-central1"

gcloud storage buckets create "gs://${BUCKET_NAME}" \
  --location="${REGION}" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update "gs://${BUCKET_NAME}" \
  --versioning
```

```hcl
# versions.tf
terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.30"
    }
  }

  backend "gcs" {
    bucket = "my-project-tfstate"
    prefix = "prod/us-central1/gke"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
```

### Workload Identity Federation for CI (keyless)

```hcl
# Allow GitHub Actions to impersonate a service account via OIDC
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  project                   = var.project_id
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  project                            = var.project_id

  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
  }

  attribute_condition = "assertion.repository_owner == 'my-org'"
}

resource "google_service_account_iam_member" "github_ci" {
  service_account_id = google_service_account.terraform_ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/my-org/my-repo"
}
```

```yaml
# GitHub Actions — keyless auth to GCP
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
    service_account: terraform-ci@my-project.iam.gserviceaccount.com
```

---

## Cloud Build

Cloud Build is GCP's managed CI service. It runs build steps as Docker containers — each step is an image. Deep integration with GCP: builds run with a Cloud Build Service Account that can be granted IAM roles.

```yaml
# cloudbuild.yaml — build, test, push, deploy
steps:
  - name: golang:1.22
    id: test
    entrypoint: go
    args: [test, ./..., -race, -coverprofile=coverage.out]

  - name: gcr.io/cloud-builders/docker
    id: build
    args:
      - build
      - --tag=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/api:$COMMIT_SHA
      - --tag=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/api:latest
      - --cache-from=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/api:latest
      - --build-arg=BUILDKIT_INLINE_CACHE=1
      - .
    env: [DOCKER_BUILDKIT=1]

  - name: gcr.io/cloud-builders/docker
    id: push
    args: [push, --all-tags, "${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/api"]
    waitFor: [build]

  - name: gcr.io/google.com/cloudsdktool/cloud-sdk
    id: deploy
    entrypoint: gcloud
    args:
      - deploy
      - releases
      - create
      - release-$SHORT_SHA
      - --delivery-pipeline=${_PIPELINE}
      - --region=${_REGION}
      - --images=api=${_REGION}-docker.pkg.dev/$PROJECT_ID/${_REPO}/api:$COMMIT_SHA
    waitFor: [push]

substitutions:
  _REGION: us-central1
  _REPO: my-app
  _PIPELINE: my-app-pipeline

options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8
  dynamic_substitutions: true
```

```hcl
# Trigger on push to main
resource "google_cloudbuild_trigger" "main" {
  name     = "${var.project}-main-push"
  project  = var.project_id
  location = var.region

  github {
    owner = "my-org"
    name  = "my-repo"
    push  { branch = "^main$" }
  }

  filename        = "cloudbuild.yaml"
  service_account = google_service_account.cloudbuild.id
}
```

---

## Artifact Registry

Artifact Registry is GCP's managed registry for container images, Helm charts, Maven/npm/Python packages. It replaces the older Container Registry (`gcr.io`).

```hcl
resource "google_artifact_registry_repository" "images" {
  repository_id = "images"
  location      = var.region
  format        = "DOCKER"
  project       = var.project_id

  cleanup_policies {
    id     = "keep-tagged-releases"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["v", "release-"]
    }
  }

  cleanup_policies {
    id     = "delete-untagged-after-7-days"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"  # 7 days
    }
  }
}

# Allow Cloud Build SA to push
resource "google_artifact_registry_repository_iam_member" "cloudbuild_push" {
  repository = google_artifact_registry_repository.images.id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_project.current.number}@cloudbuild.gserviceaccount.com"
}

# Allow GKE node SA to pull
resource "google_artifact_registry_repository_iam_member" "gke_pull" {
  repository = google_artifact_registry_repository.images.id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.gke_nodes.email}"
}
```

---

## Cloud Deploy

Cloud Deploy is GCP's managed continuous delivery service for GKE. It supports sequential targets (dev → staging → prod), canary and blue/green strategies with built-in approval gates and rollback.

```yaml
# clouddeploy.yaml
apiVersion: deploy.cloud.google.com/v1
kind: DeliveryPipeline
metadata:
  name: my-app-pipeline
spec:
  serialPipeline:
    stages:
      - targetId: dev
        profiles: [dev]
      - targetId: staging
        profiles: [staging]
        strategy:
          canary:
            runtimeConfig:
              kubernetes:
                gatewayServiceMesh:
                  httpRoute: my-app-route
                  service: my-app
                  deployment: my-app
            canaryDeployment:
              percentages: [25, 50]
              verify: true
      - targetId: prod
        profiles: [prod]
        deployParameters:
          - values:
              replicaCount: "10"
---
apiVersion: deploy.cloud.google.com/v1
kind: Target
metadata:
  name: prod
spec:
  requireApproval: true
  gke:
    cluster: projects/my-project/locations/us-central1/clusters/prod-gke
```

---

## Config Sync (Anthos Config Management)

Config Sync implements GitOps for GKE — syncs Kubernetes manifests from a Git repository (or OCI image) to GKE clusters. It is the GitOps component of Anthos Config Management (ACM).

```hcl
resource "google_gke_hub_feature" "config_management" {
  name     = "configmanagement"
  location = "global"
  project  = var.project_id
}

resource "google_gke_hub_membership" "prod" {
  membership_id = "prod-cluster"
  project       = var.project_id

  endpoint {
    gke_cluster {
      resource_link = "//container.googleapis.com/${google_container_cluster.main.id}"
    }
  }
}

resource "google_gke_hub_feature_membership" "config_sync" {
  location   = "global"
  feature    = google_gke_hub_feature.config_management.name
  membership = google_gke_hub_membership.prod.membership_id
  project    = var.project_id

  configmanagement {
    version = "1.18.0"
    config_sync {
      git {
        sync_repo   = "https://github.com/my-org/fleet-config"
        sync_branch = "main"
        policy_dir  = "clusters/prod"
        sync_wait_secs = 15
      }
    }
    policy_controller {
      enabled                  = true
      template_library_installed = true
    }
  }
}
```

!!! tip "OCI sync"
    Config Sync supports syncing from an **OCI image** stored in Artifact Registry — `sync_repo` can point to an OCI image URI instead of a Git URL. This is faster (no Git clone), works with Artifact Registry CMEK and integrates with the Artifact Registry cleanup policies.

---

[← GCP Overview](index.md){ .md-button }
