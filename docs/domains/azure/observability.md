---
title: Azure Observabilidade
description: Azure Monitor, Log Analytics, Application Insights, Container Insights, Cost Management.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / observability</span>
    <h1 class="dph-title">Azure Observabilidade</h1>
    <p class="dph-desc">Azure Monitor é o serviço guarda-chuva — métricas fluem para o armazenamento de Métricas, logs fluem para o Log Analytics, rastreamentos distribuídos fluem para o Application Insights. Container Insights fornece painéis específicos para AKS prontos para uso. Azure Managed Grafana une tudo isso.</p>
    <div class="dph-badges">
      <span class="tech-badge">Azure Monitor</span>
      <span class="tech-badge">Log Analytics</span>
      <span class="tech-badge">App Insights</span>
      <span class="tech-badge">Container Insights</span>
      <span class="tech-badge">Managed Grafana</span>
      <span class="tech-badge">Cost Management</span>
    </div>
  </div>
</div>

---

## Azure Monitor

Azure Monitor coleta métricas e logs de todos os serviços do Azure automaticamente. Os recursos enviam **métricas de plataforma** para o armazenamento de Métricas (retenção de 15 meses) e **logs de recursos** (configurações de diagnóstico) para o Log Analytics, uma Conta de Armazenamento ou um Event Hub.

### Modelo de dados

```
Azure Resource
  ├── Platform metrics  ──→ Azure Monitor Metrics (time-series, 93-day default)
  ├── Resource logs     ──→ Log Analytics Workspace (KQL query engine)
  ├── Activity logs     ──→ Activity Log (subscription-level control plane events)
  └── App telemetry     ──→ Application Insights (traces, dependencies, exceptions)
```

### Log Analytics Workspace

```hcl
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.project}-law"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 90

  # Basic tier for high-volume, infrequently queried logs (cheaper)
  # Switch individual tables to "Basic" in portal or via az CLI
}

# Send AKS control plane logs to Log Analytics
resource "azurerm_monitor_diagnostic_setting" "aks" {
  name               = "aks-diagnostics"
  target_resource_id = azurerm_kubernetes_cluster.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log { category = "kube-apiserver" }
  enabled_log { category = "kube-audit" }
  enabled_log { category = "kube-controller-manager" }
  enabled_log { category = "cloud-controller-manager" }
  metric { category = "AllMetrics"; enabled = true }
}
```

### Alertas de métrica

```hcl
resource "azurerm_monitor_metric_alert" "aks_node_cpu" {
  name                = "aks-node-cpu-high"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_kubernetes_cluster.main.id]
  severity            = 2

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  window_size        = "PT5M"
  frequency          = "PT1M"
  action { action_group_id = azurerm_monitor_action_group.ops.id }
}

resource "azurerm_monitor_action_group" "ops" {
  name                = "ops-action-group"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "ops"

  email_receiver {
    name          = "ops-email"
    email_address = "ops@example.com"
  }
}
```

---

## Application Insights

Application Insights é o componente APM (Application Performance Monitoring) do Azure Monitor. Coleta rastreamentos distribuídos, taxas de requisições, taxas de falha, tempos de resposta, dependências e eventos personalizados.

### Conceitos principais

| Conceito | Descrição |
|---------|-------------|
| **Sampling** | Amostragem adaptativa reduz o volume de dados preservando a precisão estatística |
| **Availability tests** | Pings sintéticos a partir de PoPs do Azure — alertas em caso de indisponibilidade |
| **Smart Detection** | Detecção automática de anomalias para picos de falhas e degradação do tempo de resposta |
| **Live Metrics** | Streaming em tempo real de telemetria com granularidade de 1 segundo |
| **Application Map** | Grafo de dependências de serviços gerado automaticamente |

```hcl
resource "azurerm_application_insights" "app" {
  name                = "${var.project}-ai"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  retention_in_days   = 90
}

output "app_insights_connection_string" {
  value     = azurerm_application_insights.app.connection_string
  sensitive = true
}
```

Use a string de conexão (não a chave de instrumentação obsoleta) em sua aplicação:

```python
# Python SDK — no dependency on APPLICATIONINSIGHTS_CONNECTION_STRING env var
from azure.monitor.opentelemetry import configure_azure_monitor
configure_azure_monitor(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
```

### Teste de disponibilidade

```hcl
resource "azurerm_application_insights_standard_web_test" "health" {
  name                    = "health-check"
  resource_group_name     = azurerm_resource_group.main.name
  location                = var.location
  application_insights_id = azurerm_application_insights.app.id
  frequency               = 300  # seconds
  timeout                 = 30
  enabled                 = true
  geo_locations           = [
    "us-ca-sjc-azr", "us-tx-sn1-azr", "emea-gb-db3-azr", "apac-sg-sin-azr"
  ]

  request {
    url                   = "https://${var.app_fqdn}/health"
    http_verb             = "GET"
    parse_dependent_requests = false
  }

  validation_rules {
    expected_status_code = 200
  }
}
```

---

## Container Insights

Container Insights é o complemento de observabilidade específico para AKS. Implanta um DaemonSet que coleta métricas de nós e pods e envia logs de contêineres para o Log Analytics.

```hcl
# Enable Container Insights on AKS cluster
resource "azurerm_kubernetes_cluster" "main" {
  # ... existing config ...

  oms_agent {
    log_analytics_workspace_id      = azurerm_log_analytics_workspace.main.id
    msi_auth_for_monitoring_enabled = true  # auth via managed identity
  }

  monitor_metrics {}  # enable Managed Prometheus
}
```

### Consultas KQL úteis

```kusto
// Container CPU usage by namespace
Perf
| where ObjectName == "K8SContainer"
| where CounterName == "cpuUsageNanoCores"
| summarize avg(CounterValue) by namespace=tostring(split(InstanceName, "/")[0]), bin(TimeGenerated, 5m)
| render timechart

// Pod OOMKilled events
KubePodInventory
| where Reason == "OOMKilled"
| summarize count() by Computer, Namespace, Name, bin(TimeGenerated, 1h)

// Failed image pulls
KubeEvents
| where Reason == "Failed" and Message has "ImagePullBackOff"
| project TimeGenerated, Namespace, Name, Message
```

---

## Azure Managed Grafana

Azure Managed Grafana é uma instância Grafana totalmente gerenciada. Integra-se com Azure Monitor (métricas), Azure Data Explorer e endpoints compatíveis com Prometheus, incluindo o workspace Managed Prometheus do AKS.

```hcl
resource "azurerm_dashboard_grafana" "main" {
  name                              = "${var.project}-grafana"
  resource_group_name               = azurerm_resource_group.main.name
  location                          = var.location
  sku                               = "Standard"
  grafana_major_version             = 10
  azure_monitor_workspace_integrations = [
    { resource_id = azurerm_monitor_workspace.main.id }
  ]
}

resource "azurerm_monitor_workspace" "main" {
  name                = "${var.project}-prometheus"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
}
```

---

## Cost Management

Azure Cost Management and Billing fornece orçamentos, alertas de custo, alocação de custos via tags e recomendações.

### Orçamentos

```hcl
resource "azurerm_consumption_budget_subscription" "prod" {
  name            = "prod-monthly-budget"
  subscription_id = data.azurerm_subscription.current.id

  amount     = 5000
  time_grain = "Monthly"

  time_period {
    start_date = "2024-01-01T00:00:00Z"
  }

  notification {
    enabled   = true
    threshold = 80
    operator  = "GreaterThan"
    contact_emails = ["finops@example.com"]
  }

  notification {
    enabled   = true
    threshold = 100
    operator  = "GreaterThan"
    contact_emails = ["finops@example.com", "engineering-lead@example.com"]
  }
}
```

!!! tip "Aplicação de tags para alocação de custos"
    Use **Azure Policy** para aplicar tags `environment` e `cost-center` em todos os grupos de recursos no momento da criação. Log Analytics e Cost Management suportam filtragem por tags, permitindo relatórios de custo por equipe a partir de um único workspace.

---

[← Visão Geral Azure](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
