---
title: OCI Observability
description: OCI Monitoring, Logging, Logging Analytics, APM, Ops Insights — observability on Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / observability</span>
    <h1 class="dph-title">OCI Observability</h1>
    <p class="dph-desc">OCI Monitoring provides metrics with Prometheus-compatible remote_write. Logging captures resource and audit logs. Logging Analytics applies ML for pattern detection. APM ships distributed traces via OpenTelemetry. Ops Insights provides database and host performance intelligence.</p>
    <div class="dph-badges">
      <span class="tech-badge">OCI Monitoring</span>
      <span class="tech-badge">Logging</span>
      <span class="tech-badge">Logging Analytics</span>
      <span class="tech-badge">APM</span>
      <span class="tech-badge">Ops Insights</span>
    </div>
  </div>
</div>

---

## OCI Monitoring

OCI Monitoring provides time-series metrics for all OCI resources. Custom metrics can be ingested via the Metrics API or via **Prometheus remote_write** — making it easy to centralise metrics from OKE clusters in OCI Monitoring without running your own Prometheus infrastructure.

### Alarm

```hcl
resource "oci_monitoring_alarm" "oke_cpu" {
  compartment_id        = var.compartment_id
  display_name          = "OKE High CPU"
  is_enabled            = true
  metric_compartment_id = var.compartment_id

  query     = "CpuUtilization[5m].mean() > 80"
  severity  = "WARNING"
  namespace = "oci_computeagent"

  destinations      = [oci_ons_notification_topic.ops.id]
  message_format    = "ONS_OPTIMIZED"
  pending_duration  = "PT5M"

  suppression {
    description = "Planned maintenance"
    time_suppress_from  = "2024-06-01T00:00:00Z"
    time_suppress_until = "2024-06-01T06:00:00Z"
  }
}

resource "oci_ons_notification_topic" "ops" {
  compartment_id = var.compartment_id
  name           = "${var.project}-ops-alerts"
}

resource "oci_ons_subscription" "ops_email" {
  compartment_id = var.compartment_id
  topic_id       = oci_ons_notification_topic.ops.id
  protocol       = "EMAIL"
  endpoint       = "ops@example.com"
}
```

### Prometheus remote_write to OCI Monitoring

```yaml
# Prometheus or Prometheus Operator remote_write config
remoteWrite:
  - url: "https://telemetry-ingestion.<region>.oraclecloud.com/20180401/metrics"
    sigv4: {}   # use OCI signature v1 auth
    metadata_config:
      send: true
    queue_config:
      max_shards: 10
      max_samples_per_send: 500
```

Or via OCI Managed Service for Prometheus (requires OKE with Instance Principals):

```yaml
# kube-prometheus-stack values.yaml excerpt
prometheus:
  prometheusSpec:
    remoteWrite:
      - url: "https://telemetry-ingestion.us-ashburn-1.oraclecloud.com/20180401/metrics"
        headers:
          Authorization: "Bearer ${OCI_TOKEN}"
```

---

## OCI Logging

OCI Logging captures two categories of logs:

| Category | Examples |
|---------|---------|
| **Service logs** | VCN flow logs, Load Balancer access logs, Object Storage access logs, API Gateway logs |
| **Audit logs** | All API calls within the tenancy (included automatically) |

OKE container logs (stdout/stderr) can be sent to OCI Logging via the **OCI Logging Agent** deployed as a DaemonSet.

```hcl
resource "oci_logging_log_group" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-log-group"
}

resource "oci_logging_log" "vcn_flow" {
  display_name = "vcn-flow-logs"
  log_group_id = oci_logging_log_group.main.id
  log_type     = "SERVICE"
  is_enabled   = true

  configuration {
    source {
      category    = "all"
      resource    = oci_core_subnet.private_app.id
      service     = "flowlogs"
      source_type = "OCISERVICE"
    }
    compartment_id = var.compartment_id
  }

  retention_duration = 90
}
```

### Log service connector (to Object Storage)

```hcl
resource "oci_sch_service_connector" "logs_to_storage" {
  compartment_id = var.compartment_id
  display_name   = "logs-to-object-storage"
  state          = "ACTIVE"

  source {
    kind = "logging"
    log_sources {
      compartment_id = var.compartment_id
      log_group_id   = oci_logging_log_group.main.id
    }
  }

  target {
    kind              = "objectStorage"
    bucket            = oci_objectstorage_bucket.logs.name
    namespace         = data.oci_objectstorage_namespace.current.namespace
    batch_rollover_size_in_mbs = 100
    batch_rollover_time_in_ms  = 60000
  }
}
```

---

## Logging Analytics

OCI Logging Analytics is a managed SIEM-like service that applies machine learning to log data — pattern recognition, anomaly detection, clustering and correlation across log sources.

```hcl
resource "oci_log_analytics_namespace" "main" {
  namespace      = data.oci_objectstorage_namespace.current.namespace
  compartment_id = var.compartment_id
  is_onboarded   = true
}
```

### Useful built-in parsers

| Log source | Parser |
|-----------|--------|
| OKE / Kubernetes | `Kubernetes` — parses JSON pod logs |
| OCI Audit | `OCI Audit Log` — structured events |
| VCN Flow Logs | `OCI VCN Flow Log` — parsed IP flows |
| Load Balancer | `OCI LBaaS Access Log` |
| Oracle DB | Multiple Oracle DB parsers |

---

## Application Performance Monitoring (APM)

OCI APM provides distributed tracing, synthetic monitoring and session diagnostics. It accepts traces via the **OpenTelemetry OTLP protocol** — no proprietary SDK required.

```hcl
resource "oci_apm_apm_domain" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-apm"
  is_free_tier   = false
}

output "apm_endpoint" {
  value = oci_apm_apm_domain.main.data_upload_endpoint
}
```

### OpenTelemetry configuration for OCI APM

```yaml
# OpenTelemetry Collector config — export to OCI APM
exporters:
  otlphttp/oci-apm:
    endpoint: "${APM_DATA_UPLOAD_ENDPOINT}/20200101/opentelemetry"
    headers:
      Authorization: "dataKey ${APM_PRIVATE_DATA_KEY}"
    tls:
      insecure: false

processors:
  batch:
    send_batch_size: 512
    timeout: 5s

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/oci-apm]
```

### Kubernetes OTEL collector sidecar

```yaml
containers:
  - name: otel-sidecar
    image: otel/opentelemetry-collector-contrib:latest
    args: ["--config=/conf/otel-collector.yaml"]
    env:
      - name: APM_ENDPOINT
        valueFrom:
          secretKeyRef:
            name: oci-apm-config
            key: data-upload-endpoint
      - name: APM_PRIVATE_DATA_KEY
        valueFrom:
          secretKeyRef:
            name: oci-apm-config
            key: private-data-key
```

---

## Ops Insights

Ops Insights provides capacity planning, SQL analysis and resource utilisation trends for Compute instances and Autonomous/Oracle Databases.

| Feature | Description |
|---------|-------------|
| **Capacity Planning** | Forecast CPU, memory and storage growth using ML models |
| **SQL Warehouse** | Cross-database SQL performance analysis |
| **Exadata Insights** | Fleet-level Exadata performance monitoring |
| **Host Insights** | OS-level metrics and top processes |

```hcl
resource "oci_opsi_operations_insights_warehouse" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-opsi"
  cpu_allocated  = 2
  storage_allocated_in_gbs = 500
}

resource "oci_opsi_host_insight" "app_server" {
  compartment_id       = var.compartment_id
  entity_source        = "MACS_MANAGED_EXTERNAL_HOST"
  management_agent_id  = data.oci_management_agent_management_agents.app.management_agents[0].id
  status               = "ENABLED"
}
```

---

## Budget Alerts

```hcl
resource "oci_budget_budget" "production" {
  compartment_id = var.tenancy_ocid   # budgets always in root compartment
  target_type    = "COMPARTMENT"
  targets        = [oci_identity_compartment.production.id]
  amount         = 5000
  reset_period   = "MONTHLY"
  display_name   = "Production Monthly Budget"
}

resource "oci_budget_alert_rule" "warning" {
  budget_id     = oci_budget_budget.production.id
  type          = "ACTUAL"
  threshold     = 80
  threshold_type = "PERCENTAGE"
  display_name  = "80% budget warning"
  recipients    = "finops@example.com"
  message       = "Production compartment has reached 80% of monthly budget"
}

resource "oci_budget_alert_rule" "critical" {
  budget_id      = oci_budget_budget.production.id
  type           = "ACTUAL"
  threshold      = 100
  threshold_type = "PERCENTAGE"
  display_name   = "100% budget exceeded"
  recipients     = "finops@example.com,engineering-lead@example.com"
}
```

---

[← OCI Overview](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
