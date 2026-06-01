---
title: Azure Observability
description: Azure Monitor, Log Analytics, Application Insights, Container Insights, Cost Management.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / observability</span>
    <h1 class="dph-title">Azure Observability</h1>
    <p class="dph-desc">Azure Monitor is the umbrella service — metrics flow to the Metrics store, logs flow to Log Analytics, distributed traces flow to Application Insights. Container Insights provides AKS-specific dashboards out of the box. Azure Managed Grafana ties it all together.</p>
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

Azure Monitor collects metrics and logs from all Azure services automatically. Resources send **platform metrics** to the Metrics store (15-month retention) and **resource logs** (diagnostic settings) to Log Analytics, a Storage Account or an Event Hub.

### Data model

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

### Metric alerts

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

Application Insights is the APM (Application Performance Monitoring) component of Azure Monitor. It collects distributed traces, request rates, failure rates, response times, dependencies and custom events.

### Key concepts

| Concept | Description |
|---------|-------------|
| **Sampling** | Adaptive sampling reduces data volume while preserving statistical accuracy |
| **Availability tests** | Synthetic pings from Azure PoPs — alerts on downtime |
| **Smart Detection** | Automatic anomaly detection for failure spikes, response time degradation |
| **Live Metrics** | Real-time streaming of telemetry with 1-second granularity |
| **Application Map** | Auto-generated service dependency graph |

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

Use the connection string (not the deprecated instrumentation key) in your application:

```python
# Python SDK — no dependency on APPLICATIONINSIGHTS_CONNECTION_STRING env var
from azure.monitor.opentelemetry import configure_azure_monitor
configure_azure_monitor(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
```

### Availability test

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

Container Insights is the AKS-specific observability add-on. It deploys a DaemonSet that collects node and pod metrics and ships container logs to Log Analytics.

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

### Useful KQL queries

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

Azure Managed Grafana is a fully managed Grafana instance. It integrates with Azure Monitor (metrics), Azure Data Explorer and Prometheus-compatible endpoints including the AKS Managed Prometheus workspace.

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

Azure Cost Management and Billing provides budgets, cost alerts, cost allocation via tags and recommendations.

### Budgets

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

!!! tip "Tag enforcement for cost allocation"
    Use **Azure Policy** to enforce `environment` and `cost-center` tags on all resource groups at creation time. Log Analytics and Cost Management both support filtering by tags, enabling per-team cost reporting from a single workspace.

---

[← Azure Overview](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
