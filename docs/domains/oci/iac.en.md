---
title: OCI IaC & DevOps
description: Terraform, Resource Manager, OCI DevOps, Container Registry — IaC and DevOps on Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / iac</span>
    <h1 class="dph-title">OCI IaC &amp; DevOps</h1>
    <p class="dph-desc">The Terraform OCI provider is mature and comprehensive. Resource Manager is OCI's managed Terraform service — run plans and applies without provisioning CI servers. OCI DevOps provides build and deployment pipelines. OCIR is the managed container registry integrated with OKE.</p>
    <div class="dph-badges">
      <span class="tech-badge">Terraform</span>
      <span class="tech-badge">Resource Manager</span>
      <span class="tech-badge">OCI DevOps</span>
      <span class="tech-badge">OCIR</span>
      <span class="tech-badge">Artifact Registry</span>
    </div>
  </div>
</div>

---

## Terraform — OCI Provider

The `oracle/oci` provider covers the entire OCI API surface. Remote state can use OCI Object Storage via the S3-compatible backend.

### Provider configuration

```hcl
# versions.tf
terraform {
  required_version = ">= 1.7"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket   = "my-project-tfstate"
    key      = "prod/oke/terraform.tfstate"
    region   = "us-ashburn-1"

    # OCI S3-compatible endpoint
    endpoint                    = "https://<namespace>.compat.objectstorage.us-ashburn-1.oraclecloud.com"
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    force_path_style            = true
  }
}

provider "oci" {
  region       = var.region
  tenancy_ocid = var.tenancy_ocid
  # Prefer Instance Principals or API key file authentication
  # For CI, use API key via env vars:
  # OCI_CLI_USER, OCI_CLI_FINGERPRINT, OCI_CLI_KEY_FILE, OCI_CLI_TENANCY, OCI_CLI_REGION
}
```

### Using Instance Principals in CI

For build pipelines running on OCI Compute instances (Resource Manager, or self-hosted CI on OCI), use Instance Principals — no API key file needed:

```hcl
provider "oci" {
  auth   = "InstancePrincipal"
  region = var.region
}
```

### Directory layout

```
infrastructure/
├── modules/
│   ├── vcn/           # VCN, subnets, gateways
│   ├── oke/           # OKE cluster + node pools
│   ├── vault/         # Vault + keys + secrets
│   └── devops/        # OCI DevOps project + pipelines
├── environments/
│   ├── prod/
│   │   ├── main.tf
│   │   ├── versions.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars
│   └── staging/
└── bootstrap/
    ├── main.tf        # tfstate bucket + IAM policies
    └── README.md
```

---

## Resource Manager

Resource Manager is OCI's managed Terraform service — it hosts Terraform configurations, runs plan/apply operations inside OCI without requiring external CI, and uses Instance Principals for authentication.

### Key concepts

| Concept | Description |
|---------|-------------|
| **Stack** | A Resource Manager deployment unit — contains Terraform config + state |
| **Job** | A Terraform operation (plan, apply, destroy) executed on a stack |
| **Configuration source** | Source of Terraform code: Object Storage, GitHub, GitLab, Bitbucket |

```hcl
resource "oci_resourcemanager_stack" "oke" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-oke-stack"
  description    = "OKE cluster and supporting infrastructure"
  terraform_version = "1.7.x"

  config_source {
    config_source_type = "GIT_CONFIG_SOURCE"
    git_config_source {
      repository_url  = "https://github.com/my-org/oci-infra"
      branch_name     = "main"
      configuration_source_provider_id = oci_resourcemanager_configuration_source_provider.github.id
    }
    working_directory = "/environments/prod"
  }

  variables = {
    region         = var.region
    compartment_id = var.compartment_id
    project        = var.project
  }
}
```

---

## OCI DevOps

OCI DevOps is Oracle's managed CI/CD service. It provides **Build Pipelines** (CI) and **Deployment Pipelines** (CD) with native integration with OCI Container Registry, Artifact Registry and OKE.

### Build pipeline

```yaml
# build_spec.yaml — OCI DevOps build spec
version: 0.1
component: build
timeoutInSeconds: 3600

steps:
  - type: Command
    name: Run tests
    timeoutInSeconds: 300
    command: |
      cd ${OCI_PRIMARY_SOURCE_DIR}
      go test ./... -race -coverprofile=coverage.out

  - type: Command
    name: Build container image
    timeoutInSeconds: 600
    command: |
      cd ${OCI_PRIMARY_SOURCE_DIR}
      docker build \
        --tag ${REGION}.ocir.io/${TENANCY_NAMESPACE}/${REPO}:${OCI_BUILD_RUN_ID} \
        --tag ${REGION}.ocir.io/${TENANCY_NAMESPACE}/${REPO}:latest \
        .

  - type: Command
    name: Push image
    timeoutInSeconds: 300
    command: |
      docker push ${REGION}.ocir.io/${TENANCY_NAMESPACE}/${REPO}:${OCI_BUILD_RUN_ID}
      docker push ${REGION}.ocir.io/${TENANCY_NAMESPACE}/${REPO}:latest

outputArtifacts:
  - name: container-image
    type: DOCKER_IMAGE
    location: ${REGION}.ocir.io/${TENANCY_NAMESPACE}/${REPO}:${OCI_BUILD_RUN_ID}
```

```hcl
resource "oci_devops_project" "main" {
  compartment_id = var.compartment_id
  name           = var.project
  notification_config {
    topic_id = oci_ons_notification_topic.devops.id
  }
  logging_config {
    log_group_id = oci_logging_log_group.devops.id
    log_id       = oci_logging_log.devops.id
  }
}

resource "oci_devops_build_pipeline" "main" {
  project_id   = oci_devops_project.main.id
  display_name = "${var.project}-build"

  build_pipeline_parameters {
    items {
      name          = "REGION"
      default_value = var.region
    }
  }
}
```

### Deployment pipeline — OKE blue/green

```hcl
resource "oci_devops_deploy_pipeline" "oke" {
  project_id   = oci_devops_project.main.id
  display_name = "${var.project}-deploy-oke"

  deploy_pipeline_parameters {
    items {
      name          = "IMAGE_TAG"
      default_value = "latest"
    }
  }
}

resource "oci_devops_deploy_stage" "canary" {
  deploy_pipeline_id = oci_devops_deploy_pipeline.oke.id
  display_name       = "Canary Deployment"

  deploy_stage_type = "OKE_CANARY_DEPLOYMENT"

  oke_canary_deploy_stage_collection {
    items {
      kubernetes_cluster_id = oci_containerengine_cluster.main.id
      namespace             = "production"
    }
  }
  container_config {
    container_config_type = "CONTAINER_INSTANCE_CONFIG"
    availability_domain   = data.oci_identity_availability_domains.ads.availability_domains[0].name
    compartment_id        = var.compartment_id
    shape_name            = "CI.Standard.A1.Flex"
    shape_config { ocpus = 1; memory_in_gbs = 2 }
    network_channel {
      network_channel_type = "SERVICE_VNIC_CHANNEL"
      subnet_id            = oci_core_subnet.private_app.id
    }
  }
}
```

---

## OCI Container Registry (OCIR)

OCIR is OCI's managed container registry — a Docker v2-compatible registry available in every OCI region. Images are stored per-region under `<region>.ocir.io/<namespace>/<repo>:<tag>`.

```hcl
resource "oci_artifacts_container_repository" "api" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}/api"
  is_public      = false
  is_immutable   = false  # set true for production to prevent tag overwrites

  readme {
    content = "API service container image repository"
    format  = "TEXT"
  }
}
```

### Authenticate Docker to OCIR

```bash
# Using an Auth Token (user-level — for human use)
docker login \
  --username "${TENANCY_NAMESPACE}/${OCI_USERNAME}" \
  --password "${OCI_AUTH_TOKEN}" \
  "${REGION}.ocir.io"

# Using Instance Principal (for OCI DevOps / Resource Manager)
# No docker login required — OCI DevOps service handles registry auth automatically
```

### OKE pull from OCIR (Instance Principals)

OKE nodes authenticated via Instance Principals can pull from OCIR in the same tenancy without an `imagePullSecret`. Set the policy:

```hcl
resource "oci_identity_policy" "oke_pull_ocir" {
  compartment_id = var.tenancy_ocid
  name           = "oke-pull-ocir"
  description    = "Allow OKE nodes to pull images from OCIR"

  statements = [
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to read repos in compartment id ${oci_artifacts_container_repository.api.compartment_id}",
  ]
}
```

---

## OCI Artifact Registry

OCI Artifact Registry stores generic artefacts — JAR files, Helm charts, Terraform modules, configuration bundles — separate from container images.

```hcl
resource "oci_artifacts_repository" "helm" {
  compartment_id  = var.compartment_id
  display_name    = "${var.project}-helm-charts"
  repository_type = "GENERIC"
  is_immutable    = false
  description     = "Helm chart repository for ${var.project} services"
}
```

### Push a Helm chart

```bash
# Push a Helm chart to OCI Artifact Registry
helm package ./charts/api --version 1.2.3

oci_helm_push() {
  helm push \
    api-1.2.3.tgz \
    "oci://${REGION}.ocir.io/${NAMESPACE}/${REPO}"
}
```

---

[← OCI Overview](index.md){ .md-button }
