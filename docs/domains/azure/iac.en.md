---
title: Azure IaC & DevOps
description: Terraform, Bicep, Azure DevOps Pipelines, ACR, Flux v2 — IaC and GitOps on Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / iac</span>
    <h1 class="dph-title">Azure IaC &amp; DevOps</h1>
    <p class="dph-desc">Terraform with the AzureRM provider is the most common choice for Azure IaC. Bicep is the native ARM replacement with much cleaner syntax. Azure DevOps provides enterprise-grade pipelines with built-in service connection federation to Azure and Flux v2 closes the GitOps loop.</p>
    <div class="dph-badges">
      <span class="tech-badge">Terraform</span>
      <span class="tech-badge">Bicep</span>
      <span class="tech-badge">Azure DevOps</span>
      <span class="tech-badge">ACR</span>
      <span class="tech-badge">Flux v2</span>
      <span class="tech-badge">OIDC</span>
    </div>
  </div>
</div>

---

## Terraform — AzureRM Provider

The `hashicorp/azurerm` provider is the de-facto standard for managing Azure resources. Always pin the provider version and use a remote backend in Azure Blob Storage.

### Remote backend setup

```bash
# Bootstrap the backend storage account
RESOURCE_GROUP="tfstate-rg"
STORAGE_ACCOUNT="myprojecttfstate$(shuf -i 1000-9999 -n1)"
CONTAINER="tfstate"
LOCATION="eastus"

az group create --name $RESOURCE_GROUP --location $LOCATION
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_ZRS \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false
az storage container create \
  --name $CONTAINER \
  --account-name $STORAGE_ACCOUNT
```

```hcl
# versions.tf
terraform {
  required_version = ">= 1.7"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.50"
    }
  }

  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "myprojecttfstate"
    container_name       = "tfstate"
    key                  = "prod/eastus/aks/terraform.tfstate"
    use_oidc             = true
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
  use_oidc = true  # OIDC federation — no client secrets in CI
}
```

### OIDC federation — keyless CI authentication

```hcl
# Create a Service Principal with federated credentials for GitHub Actions
resource "azuread_application" "terraform_ci" {
  display_name = "terraform-ci-${var.env}"
}

resource "azuread_service_principal" "terraform_ci" {
  client_id = azuread_application.terraform_ci.client_id
}

resource "azuread_application_federated_identity_credential" "github" {
  application_id = azuread_application.terraform_ci.id
  display_name   = "github-actions-main"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:my-org/my-repo:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "terraform_ci_contributor" {
  scope                = data.azurerm_subscription.current.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.terraform_ci.object_id
}
```

### Directory structure

```
infrastructure/
├── modules/
│   ├── aks/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── networking/
├── environments/
│   ├── prod/
│   │   ├── main.tf          # calls modules
│   │   ├── versions.tf      # backend + provider pins
│   │   └── terraform.tfvars
│   └── staging/
└── bootstrap/               # tfstate backend resources
    └── main.tf
```

---

## Bicep — Native Azure IaC

Bicep is the first-class Azure IaC language. It compiles to ARM templates and has full parity with ARM — but with clean syntax, proper types and excellent VS Code tooling.

```bicep
// aks.bicep
param clusterName string
param location string = resourceGroup().location
param kubernetesVersion string = '1.29'
param nodeCount int = 3

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: clusterName
  location: location
  identity: { type: 'SystemAssigned' }
  sku: { name: 'Base'; tier: 'Standard' }
  properties: {
    kubernetesVersion: kubernetesVersion
    dnsPrefix: clusterName
    agentPoolProfiles: [
      {
        name: 'system'
        count: nodeCount
        vmSize: 'Standard_D4s_v5'
        mode: 'System'
        osDiskType: 'Ephemeral'
        osType: 'Linux'
      }
    ]
    oidcIssuerProfile: { enabled: true }
    securityProfile: { workloadIdentity: { enabled: true } }
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'calico'
      loadBalancerSku: 'standard'
    }
    addonProfiles: {
      omsagent: {
        enabled: true
        config: { logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId }
      }
    }
  }
}

output clusterOidcIssuerUrl string = aks.properties.oidcIssuerProfile.issuerURL
```

!!! tip "Bicep vs Terraform"
    Use **Terraform** when you manage Azure + other clouds (multi-cloud environments). Use **Bicep** for Azure-only shops or when you need first-class support for every Azure preview feature on day 0 — Bicep tracks the ARM API faster than the Terraform AzureRM provider.

---

## Azure DevOps Pipelines

Azure DevOps (ADO) Pipelines is Microsoft's CI/CD service — deeply integrated with Azure Resource Manager via **Service Connections** (federated OIDC or managed identity).

### YAML pipeline — Terraform deploy

```yaml
# .azure-pipelines/terraform.yml
trigger:
  branches: { include: [main] }
  paths: { include: [infrastructure/environments/prod/**] }

pool:
  vmImage: ubuntu-latest

variables:
  TF_DIR: infrastructure/environments/prod
  ARM_USE_OIDC: "true"
  ARM_CLIENT_ID: $(AZURE_CLIENT_ID)
  ARM_TENANT_ID: $(AZURE_TENANT_ID)
  ARM_SUBSCRIPTION_ID: $(AZURE_SUBSCRIPTION_ID)

stages:
  - stage: Plan
    jobs:
      - job: TerraformPlan
        steps:
          - task: TerraformInstaller@1
            inputs: { terraformVersion: "1.8.x" }

          - task: AzureCLI@2
            displayName: terraform init & plan
            inputs:
              azureSubscription: my-azure-service-connection
              addSpnToEnvironment: true
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                export ARM_OIDC_TOKEN=$idToken
                cd $(TF_DIR)
                terraform init -input=false
                terraform plan -out=tfplan -input=false
            env:
              ARM_USE_OIDC: "true"

          - publish: $(TF_DIR)/tfplan
            artifact: tfplan

  - stage: Apply
    dependsOn: Plan
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: TerraformApply
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: tfplan
                - task: AzureCLI@2
                  displayName: terraform apply
                  inputs:
                    azureSubscription: my-azure-service-connection
                    addSpnToEnvironment: true
                    scriptType: bash
                    scriptLocation: inlineScript
                    inlineScript: |
                      export ARM_OIDC_TOKEN=$idToken
                      cd $(TF_DIR)
                      terraform init -input=false
                      terraform apply -auto-approve $(Pipeline.Workspace)/tfplan/tfplan
```

---

## Azure Container Registry (ACR)

ACR is Azure's managed container registry. Integrates with AKS via a built-in `AcrPull` role assignment on the kubelet identity — no secrets required.

```hcl
resource "azurerm_container_registry" "main" {
  name                = "${var.project}acr${var.env}"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sku                 = "Premium"  # required for Private Link, geo-replication
  admin_enabled       = false      # use RBAC, not admin credentials
  zone_redundancy_enabled = true

  georeplications {
    location                = "westeurope"
    zone_redundancy_enabled = true
  }

  network_rule_set {
    default_action = "Deny"
    virtual_network { action = "Allow"; subnet_id = azurerm_subnet.aks.id }
  }
}

# AKS kubelet identity pulls images without credentials
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
```

### Image lifecycle policy

```json
{
  "rules": [
    {
      "name": "expire-untagged",
      "action": { "type": "Delete" },
      "selection": {
        "tagStatus": "untagged",
        "untaggedSince": "7 days"
      }
    },
    {
      "name": "keep-last-20-tags",
      "action": { "type": "Delete" },
      "selection": {
        "tagStatus": "tagged",
        "tagPattern": ".*",
        "countType": "imageCountMoreThan",
        "countNumber": 20
      }
    }
  ]
}
```

---

## Flux v2 — GitOps on AKS

Flux v2 is the CNCF GitOps operator. The **Azure GitOps** add-on deploys and manages Flux on AKS clusters with Azure Monitor integration for reconciliation status.

```hcl
resource "azurerm_kubernetes_cluster_extension" "flux" {
  name              = "flux"
  cluster_id        = azurerm_kubernetes_cluster.main.id
  extension_type    = "microsoft.flux"
  release_namespace = "flux-system"

  configuration_settings = {
    "helm-controller.enabled"         = "true"
    "image-automation-controller.enabled" = "false"
  }
}

resource "azurerm_kubernetes_flux_configuration" "apps" {
  name       = "cluster-apps"
  cluster_id = azurerm_kubernetes_cluster.main.id
  namespace  = "flux-system"
  scope      = "cluster"

  git_repository {
    url                      = "https://github.com/my-org/fleet-config"
    reference_type           = "branch"
    reference_value          = "main"
    sync_interval_in_seconds = 60
  }

  kustomizations {
    name                     = "infrastructure"
    path                     = "./clusters/prod/infrastructure"
    sync_interval_in_seconds = 120
    retry_interval_in_seconds = 60
    garbage_collection_enabled = true
  }

  kustomizations {
    name                     = "apps"
    path                     = "./clusters/prod/apps"
    depends_on               = ["infrastructure"]
    sync_interval_in_seconds = 60
    garbage_collection_enabled = true
  }
}
```

---

[← Azure Overview](index.md){ .md-button }
