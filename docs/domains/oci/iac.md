---
title: OCI IaC & DevOps
description: Terraform, Resource Manager, OCI DevOps, Container Registry — IaC e DevOps na Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / iac</span>
    <h1 class="dph-title">OCI IaC &amp; DevOps</h1>
    <p class="dph-desc">O provider Terraform para OCI é maduro e abrangente. O Resource Manager é o serviço Terraform gerenciado da OCI — execute plans e applies sem provisionar servidores CI. O OCI DevOps fornece pipelines de build e implantação. O OCIR é o registro de contêiner gerenciado integrado ao OKE.</p>
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

## Terraform — Provider OCI

O provider `oracle/oci` cobre toda a superfície da API OCI. O estado remoto pode usar o OCI Object Storage via backend compatível com S3.

### Configuração do provider

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

### Usando Instance Principals em CI

Para pipelines de build executados em instâncias OCI Compute (Resource Manager, ou CI auto-hospedado na OCI), use Instance Principals — sem necessidade de arquivo de chave de API:

```hcl
provider "oci" {
  auth   = "InstancePrincipal"
  region = var.region
}
```

### Estrutura de diretórios

```
infrastructure/
├── modules/
│   ├── vcn/           # VCN, sub-redes, gateways
│   ├── oke/           # Cluster OKE + grupos de nós
│   ├── vault/         # Vault + chaves + segredos
│   └── devops/        # Projeto OCI DevOps + pipelines
├── environments/
│   ├── prod/
│   │   ├── main.tf
│   │   ├── versions.tf
│   │   ├── variables.tf
│   │   └── terraform.tfvars
│   └── staging/
└── bootstrap/
    ├── main.tf        # bucket de tfstate + políticas IAM
    └── README.md
```

---

## Resource Manager

O Resource Manager é o serviço Terraform gerenciado da OCI — ele hospeda configurações Terraform, executa operações de plan/apply dentro da OCI sem exigir CI externo, e usa Instance Principals para autenticação.

### Conceitos principais

| Conceito | Descrição |
|---------|-----------|
| **Stack** | Uma unidade de implantação do Resource Manager — contém configuração Terraform + estado |
| **Job** | Uma operação Terraform (plan, apply, destroy) executada em uma stack |
| **Fonte de configuração** | Fonte do código Terraform: Object Storage, GitHub, GitLab, Bitbucket |

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

O OCI DevOps é o serviço de CI/CD gerenciado da Oracle. Ele fornece **Build Pipelines** (CI) e **Deployment Pipelines** (CD) com integração nativa com OCI Container Registry, Artifact Registry e OKE.

### Pipeline de build

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

### Pipeline de implantação — OKE blue/green

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

O OCIR é o registro de contêiner gerenciado da OCI — um registro compatível com Docker v2 disponível em todas as regiões OCI. As imagens são armazenadas por região em `<region>.ocir.io/<namespace>/<repo>:<tag>`.

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

### Autenticar Docker no OCIR

```bash
# Using an Auth Token (user-level — for human use)
docker login \
  --username "${TENANCY_NAMESPACE}/${OCI_USERNAME}" \
  --password "${OCI_AUTH_TOKEN}" \
  "${REGION}.ocir.io"

# Using Instance Principal (for OCI DevOps / Resource Manager)
# No docker login required — OCI DevOps service handles registry auth automatically
```

### OKE pull do OCIR (Instance Principals)

Nós OKE autenticados via Instance Principals podem fazer pull do OCIR no mesmo tenancy sem um `imagePullSecret`. Defina a política:

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

O OCI Artifact Registry armazena artefatos genéricos — arquivos JAR, charts Helm, módulos Terraform, pacotes de configuração — separados das imagens de contêiner.

```hcl
resource "oci_artifacts_repository" "helm" {
  compartment_id  = var.compartment_id
  display_name    = "${var.project}-helm-charts"
  repository_type = "GENERIC"
  is_immutable    = false
  description     = "Helm chart repository for ${var.project} services"
}
```

### Fazer push de um chart Helm

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

[← Visão Geral OCI](index.md){ .md-button }
