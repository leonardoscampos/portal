---
title: Azure Compute
description: Azure VMs, AKS, App Service, Container Apps, Functions — computação no Microsoft Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / compute</span>
    <h1 class="dph-title">Azure Compute</h1>
    <p class="dph-desc">De clusters Kubernetes gerenciados a containers serverless com KEDA, o Azure oferece computação para cada perfil de carga de trabalho. O AKS é o carro-chefe — pronto para produção, profundamente integrado ao Entra ID e à stack de rede do Azure.</p>
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

As Azure VMs cobrem todas as cargas de trabalho, de uso geral a HPC com aceleração por GPU. A convenção de nomenclatura codifica a capacidade: `Standard_D4s_v5` → Série D (geral), 4 vCPUs, s = armazenamento premium, geração v5.

### Visão Geral das Séries de VM

| Série | Propósito | Tamanhos de Exemplo |
|-------|-----------|---------------------|
| **B** (Expansível) | Dev/teste, CPU variável | `Standard_B2s`, `Standard_B4ms` |
| **D** (Geral) | CPU/memória balanceados | `Standard_D4s_v5`, `Standard_D8s_v5` |
| **F** (Computação) | Alta proporção CPU/memória | `Standard_F8s_v2`, `Standard_F16s_v2` |
| **E** (Memória) | Bancos de dados em memória, JVMs grandes | `Standard_E8s_v5`, `Standard_E32s_v5` |
| **L** (Armazenamento) | Alto throughput NVMe local | `Standard_L8s_v3`, `Standard_L32s_v3` |
| **N** (GPU) | Treinamento de ML, renderização | `Standard_NC24ads_A100_v4` |

!!! tip "Spot VMs"
    Use **Azure Spot VMs** para cargas de trabalho em lote tolerantes a falhas com até 90% de desconto. Defina uma política de remoção `Deallocate` (mantém o disco) em vez de `Delete` para preservar o estado entre remoções.

### Virtual Machine Scale Sets (VMSS)

VMSS é o equivalente Azure dos ASGs da AWS — gerencia uma frota de instâncias de VM idênticas com escalonamento automático e atualizações graduais.

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

AKS é o serviço Kubernetes gerenciado do Azure. O plano de controle é totalmente gerenciado; você paga apenas pelos nós agentes. O AKS integra-se nativamente com Azure CNI, Entra ID Workload Identity, Azure Monitor, ACR e Azure Policy.

### Tipos de Node Pool

| Tipo | Descrição | Melhor para |
|------|-----------|-------------|
| **Node pool de sistema** | Executa pods de sistema críticos (coredns, metrics-server) | Obrigatório em todo cluster |
| **Node pool de usuário** | Pods de carga de trabalho, separados do sistema | Isolar cargas de trabalho por pool |
| **Node pool Spot** | VMs removíveis com grande desconto | Batch, executores de CI |
| **Virtual nodes** (ACI) | Burst serverless; sem provisionamento de VM | Cargas de trabalho com picos |

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

### Workload Identity (autenticação em nível de pod)

Substitui as identidades gerenciadas por pod (aad-pod-identity, agora depreciado). Usa federação OIDC — os pods recebem um token assinado em que o Azure confia, eliminando a necessidade de segredos de cliente ou certificados.

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

Azure Container Apps é uma plataforma de containers serverless construída sobre Kubernetes + KEDA + Dapr — sem expor nenhuma API Kubernetes. Ideal para microsserviços, workers orientados a eventos e backends de API que precisam de scale-to-zero.

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

Computação serverless orientada a eventos. Suporta tipos de gatilho: HTTP, Timer, Service Bus, Event Hub, Blob, Queue, feed de alterações do Cosmos DB e mais.

### Planos de Hospedagem

| Plano | Cold start | Escala | Melhor para |
|-------|-----------|--------|-------------|
| **Consumption** | Sim | 0→200 instâncias | Cargas de trabalho infrequentes e com picos |
| **Flex Consumption** | Minimizado | 0→1000, pré-aquecido | Alta escala com controle de custo |
| **Premium** | Não | 1→100 (pré-aquecido) | Baixa latência, integração com VNet |
| **Dedicated (App Service)** | Não | Manual/ASG | Cargas de trabalho previsíveis e sempre ativas |

!!! tip "Durable Functions"
    Use **Durable Functions** para orquestrações com estado: padrões fan-out/fan-in, fluxos de trabalho de longa duração com etapas de aprovação humana e encadeamento de operações assíncronas sem gerenciar estado externamente.

---

## Azure Arc

Azure Arc estende o plano de controle do Azure para infraestrutura fora do Azure — servidores on-premises, VMs em outras nuvens e dispositivos de borda. Do ponto de vista DevOps, o caso de uso mais valioso é o **Kubernetes habilitado para Arc**, que permite gerenciar clusters não-Azure (EKS, GKE, on-prem) por meio das ferramentas do Azure.

| Capacidade Arc | O que habilita |
|----------------|----------------|
| **Servidores habilitados para Arc** | Azure Policy, Azure Monitor, Defender para Servidores em VMs não-Azure |
| **Kubernetes habilitado para Arc** | GitOps (Flux v2), Azure Monitor, Defender para Containers em qualquer cluster |
| **Serviços de dados habilitados para Arc** | SQL Managed Instance on-premises com faturamento e patches do Azure |

---

[← Visão Geral Azure](index.md){ .md-button }
[Armazenamento →](storage.md){ .md-button .md-button--primary }
