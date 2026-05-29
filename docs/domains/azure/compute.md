---
title: Azure Compute
description: Azure VMs, AKS, App Service, Container Apps, Functions — compute on Microsoft Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / compute</span>
    <h1 class="dph-title">Azure Compute</h1>
    <p class="dph-desc">From managed Kubernetes clusters to KEDA-powered serverless containers, Azure provides compute for every workload profile. AKS is the flagship — production-ready, deeply integrated with Entra ID and the Azure networking stack.</p>
    <div class="dph-badges">
      <span class="tech-badge">Azure VMs</span>
      <span class="tech-badge">AKS</span>
      <span class="tech-badge">App Service</span>
      <span class="tech-badge">Container Apps</span>
      <span class="tech-badge">Azure Functions</span>
      <span class="tech-badge">Azure Arc</span>
    </div>
  </div>
</div>

---

## Azure Virtual Machines

Azure VMs cover every workload from general-purpose to GPU-accelerated HPC. The naming convention encodes the capability: `Standard_D4s_v5` → D-series (general), 4 vCPUs, s = premium storage, v5 generation.

### VM series overview

| Series | Purpose | Example sizes |
|--------|---------|--------------|
| **B** (Burstable) | Dev/test, variable CPU | `Standard_B2s`, `Standard_B4ms` |
| **D** (General) | Balanced CPU/memory | `Standard_D4s_v5`, `Standard_D8s_v5` |
| **F** (Compute) | High CPU-to-memory | `Standard_F8s_v2`, `Standard_F16s_v2` |
| **E** (Memory) | In-memory databases, large JVMs | `Standard_E8s_v5`, `Standard_E32s_v5` |
| **L** (Storage) | High local NVMe throughput | `Standard_L8s_v3`, `Standard_L32s_v3` |
| **N** (GPU) | ML training, rendering | `Standard_NC24ads_A100_v4` |

!!! tip "Spot VMs"
    Use **Azure Spot VMs** for fault-tolerant batch workloads at up to 90% discount. Set an eviction policy of `Deallocate` (retains disk) rather than `Delete` to preserve state across evictions.

### Virtual Machine Scale Sets (VMSS)

VMSS is the Azure equivalent of AWS ASGs — manages a fleet of identical VM instances with automatic scaling and rolling upgrades.

```hcl
resource "azurerm_linux_virtual_machine_scale_set" "app" {
  name                = "${var.project}-vmss"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard_D4s_v5"
  instances           = 2
  admin_username      = "azureuser"

  admin_ssh_key {
    username   = "azureuser"
    public_key = file("~/.ssh/id_rsa.pub")
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }

  identity {
    type = "SystemAssigned"
  }

  network_interface {
    name    = "internal"
    primary = true
    ip_configuration {
      name                                   = "internal"
      primary                                = true
      subnet_id                              = azurerm_subnet.app.id
      load_balancer_backend_address_pool_ids = [azurerm_lb_backend_address_pool.app.id]
    }
  }
}
```

---

## AKS — Azure Kubernetes Service

AKS is Azure's managed Kubernetes service. The control plane is fully managed; you pay only for agent nodes. AKS integrates natively with Azure CNI, Entra ID Workload Identity, Azure Monitor, ACR and Azure Policy.

### Node pool types

| Type | Description | Best for |
|------|-------------|---------|
| **System node pool** | Runs critical system pods (coredns, metrics-server) | Required in every cluster |
| **User node pool** | Workload pods, separate from system | Isolate workloads by pool |
| **Spot node pool** | Evictable VMs at deep discount | Batch, CI runners |
| **Virtual nodes** (ACI) | Serverless burst; no VM provisioning | Spiky workloads |

```hcl
resource "azurerm_kubernetes_cluster" "main" {
  name                = "${var.project}-aks"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  dns_prefix          = var.project
  kubernetes_version  = "1.29"

  default_node_pool {
    name                = "system"
    node_count          = 2
    vm_size             = "Standard_D4s_v5"
    vnet_subnet_id      = azurerm_subnet.aks.id
    os_disk_type        = "Ephemeral"
    only_critical_addons_enabled = true
  }

  identity { type = "SystemAssigned" }

  network_profile {
    network_plugin     = "azure"
    network_policy     = "calico"
    load_balancer_sku  = "standard"
    outbound_type      = "userDefinedRouting"  # egress via firewall
  }

  oidc_issuer_enabled       = true
  workload_identity_enabled = true  # Entra ID Workload Identity

  azure_active_directory_role_based_access_control {
    managed            = true
    azure_rbac_enabled = true
  }

  monitor_metrics {}  # Managed Prometheus
}

resource "azurerm_kubernetes_cluster_node_pool" "app" {
  name                  = "app"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.main.id
  vm_size               = "Standard_D8s_v5"
  node_count            = 3
  vnet_subnet_id        = azurerm_subnet.aks.id
  os_disk_type          = "Ephemeral"
  mode                  = "User"

  node_labels = { "workload" = "app" }
}
```

### Workload Identity (pod-level auth)

Replaces pod-managed identities (aad-pod-identity, now deprecated). Uses OIDC federation — pods get a signed token that Azure trusts, eliminating the need for client secrets or certificates.

```hcl
resource "azurerm_user_assigned_identity" "app" {
  name                = "${var.project}-app-identity"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
}

resource "azurerm_federated_identity_credential" "app" {
  name                = "aks-app-federation"
  resource_group_name = azurerm_resource_group.main.name
  parent_id           = azurerm_user_assigned_identity.app.id
  audience            = ["api://AzureADTokenExchange"]
  issuer              = azurerm_kubernetes_cluster.main.oidc_issuer_url
  subject             = "system:serviceaccount:${var.namespace}:${var.service_account}"
}
```

---

## Container Apps

Azure Container Apps is a serverless container platform built on Kubernetes + KEDA + Dapr — without exposing any Kubernetes API. Ideal for microservices, event-driven workers and API backends that need scale-to-zero.

```hcl
resource "azurerm_container_app" "api" {
  name                         = "api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  template {
    container {
      name   = "api"
      image  = "${azurerm_container_registry.main.login_server}/api:latest"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "DB_PASSWORD"
        secret_name = "db-password"
      }
    }
    min_replicas = 1
    max_replicas = 20

    custom_scale_rule {
      name             = "http-scaling"
      custom_rule_type = "http"
      metadata = { concurrentRequests = "50" }
    }
  }
}
```

---

## Azure Functions

Serverless event-driven compute. Supports trigger types: HTTP, Timer, Service Bus, Event Hub, Blob, Queue, Cosmos DB change feed and more.

### Hosting plans

| Plan | Cold start | Scale | Best for |
|------|-----------|-------|---------|
| **Consumption** | Yes | 0→200 instances | Infrequent, bursty workloads |
| **Flex Consumption** | Minimised | 0→1000, pre-warm | High-scale with cost control |
| **Premium** | No | 1→100 (pre-warmed) | Low-latency, VNet integration |
| **Dedicated (App Service)** | No | Manual/ASG | Predictable, always-on workloads |

!!! tip "Durable Functions"
    Use **Durable Functions** for stateful orchestrations: fan-out/fan-in patterns, long-running workflows with human approval steps, and chaining async operations without managing state externally.

---

## Azure Arc

Azure Arc extends the Azure control plane to infrastructure outside Azure — on-premises servers, other cloud VMs, and edge devices. From a DevOps perspective, the most valuable use case is **Arc-enabled Kubernetes**, which lets you manage non-Azure clusters (EKS, GKE, on-prem) through Azure's tooling.

| Arc capability | What it enables |
|---------------|----------------|
| **Arc-enabled servers** | Azure Policy, Azure Monitor, Defender for Servers on non-Azure VMs |
| **Arc-enabled Kubernetes** | GitOps (Flux v2), Azure Monitor, Defender for Containers on any cluster |
| **Arc-enabled data services** | SQL Managed Instance on-prem with Azure billing and patching |

---

[← Azure Overview](index.md){ .md-button }
[Storage →](storage.md){ .md-button .md-button--primary }
