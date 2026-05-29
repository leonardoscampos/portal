---
title: GCP Observability
description: Cloud Monitoring, Cloud Logging, Cloud Trace, Managed Prometheus, Error Reporting — observability on GCP.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / observability</span>
    <h1 class="dph-title">GCP Observability</h1>
    <p class="dph-desc">Cloud Operations Suite (formerly Stackdriver) covers metrics, logs and traces. Google Managed Service for Prometheus (GMP) provides native PromQL for GKE. Cloud Trace supports OpenTelemetry natively. SLO monitoring is first-class in Cloud Monitoring.</p>
    <div class="dph-badges">
      <span class="tech-badge">Cloud Monitoring</span>
      <span class="tech-badge">Cloud Logging</span>
      <span class="tech-badge">Cloud Trace</span>
      <span class="tech-badge">GMP</span>
      <span class="tech-badge">Error Reporting</span>
      <span class="tech-badge">SLO Monitoring</span>
    </div>
  </div>
</div>

---

## Cloud Monitoring

Cloud Monitoring collects metrics from all GCP services automatically. Custom metrics can be pushed via the Cloud Monitoring API or via the OpenTelemetry SDK. **Google Managed Service for Prometheus (GMP)** provides a PromQL interface over GKE metrics.

### Alert policies

```hcl
resource "google_monitoring_alert_policy" "gke_cpu" {
  display_name = "GKE High CPU Usage"
  combiner     = "OR"
  project      = var.project_id

  conditions {
    display_name = "Container CPU utilisation > 80%"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "k8s_container"
        AND metric.type = "kubernetes.io/container/cpu/request_utilization"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0.80
      duration        = "300s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.pagerduty.name]

  alert_strategy {
    auto_close = "86400s"  # auto-close after 24h if resolved
  }
}

resource "google_monitoring_notification_channel" "pagerduty" {
  display_name = "PagerDuty"
  type         = "pagerduty"
  project      = var.project_id

  sensitive_labels {
    service_key = var.pagerduty_service_key
  }
}
```

### SLO Monitoring

```hcl
resource "google_monitoring_custom_service" "api" {
  service_id   = "api-service"
  display_name = "API Service"
  project      = var.project_id
}

resource "google_monitoring_slo" "availability" {
  service      = google_monitoring_custom_service.api.service_id
  display_name = "API Availability SLO"
  project      = var.project_id

  goal                = 0.999   # 99.9% availability
  rolling_period_days = 28

  request_based_sli {
    good_total_ratio {
      good_service_filter = <<-EOT
        resource.type="k8s_container"
        AND metric.type="custom.googleapis.com/api/request_count"
        AND metric.labels.status="2xx"
      EOT
      total_service_filter = <<-EOT
        resource.type="k8s_container"
        AND metric.type="custom.googleapis.com/api/request_count"
      EOT
    }
  }
}
```

---

## Google Managed Service for Prometheus (GMP)

GMP is a managed Prometheus service for GKE. It is fully compatible with the Prometheus data model and PromQL, stores data in Google's global metric backend, and requires no Prometheus cluster to operate.

```yaml
# Enable GMP on GKE cluster via PodMonitoring CRD
apiVersion: monitoring.googleapis.com/v1
kind: PodMonitoring
metadata:
  name: api-monitoring
  namespace: production
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: metrics
      interval: 30s
      path: /metrics
```

```hcl
# Enable managed collection on the GKE cluster
resource "google_container_cluster" "main" {
  # ...
  monitoring_config {
    enable_components = [
      "SYSTEM_COMPONENTS",
      "WORKLOADS",
    ]
    managed_prometheus { enabled = true }
  }
}
```

### Grafana integration

Connect a Grafana instance to GMP using the Cloud Monitoring data source with PromQL:

```yaml
# Grafana datasource for GMP
datasources:
  - name: GMP
    type: stackdriver
    jsonData:
      authenticationType: gce  # uses GCE service account when running in GKE
```

---

## Cloud Logging

Cloud Logging automatically collects logs from all GCP services. GKE container logs (stdout/stderr) are captured by the GKE logging agent and sent to Cloud Logging automatically.

### Log-based metrics

```hcl
resource "google_logging_metric" "error_count" {
  name   = "api-error-rate"
  filter = <<-EOT
    resource.type="k8s_container"
    AND resource.labels.namespace_name="production"
    AND jsonPayload.severity="ERROR"
  EOT

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
    labels {
      key        = "error_type"
      value_type = "STRING"
    }
  }

  label_extractors = {
    "error_type" = "EXTRACT(jsonPayload.error_type)"
  }
}
```

### Log sink (export to BigQuery)

```hcl
resource "google_logging_project_sink" "bigquery" {
  name                   = "logs-to-bigquery"
  destination            = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.logs.dataset_id}"
  filter                 = "resource.type=k8s_container"
  unique_writer_identity = true

  bigquery_options { use_partitioned_tables = true }
}

resource "google_bigquery_dataset_iam_member" "sink_writer" {
  dataset_id = google_bigquery_dataset.logs.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.bigquery.writer_identity
}
```

---

## Cloud Trace

Cloud Trace is GCP's distributed tracing service. It accepts spans via the OpenTelemetry OTLP protocol and integrates with Cloud Monitoring for trace-to-metric correlation.

```python
# Python — OpenTelemetry with GCP exporter
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(CloudTraceSpanExporter())
)
trace.set_tracer_provider(provider)

# Instrument FastAPI automatically
FastAPIInstrumentor.instrument()
```

```yaml
# OTEL collector sidecar for GKE pods
containers:
  - name: otel-collector
    image: otel/opentelemetry-collector-contrib:latest
    args: ["--config=/conf/otel-collector-config.yaml"]
    volumeMounts:
      - name: otel-collector-config
        mountPath: /conf
```

---

## Error Reporting

Error Reporting automatically groups exceptions from Cloud Functions, Cloud Run, GKE, App Engine and Compute Engine logs into distinct error groups with stack traces, affected users and resolution status.

```python
# Python — report errors manually
from google.cloud import error_reporting

client = error_reporting.Client()

try:
    do_risky_operation()
except Exception:
    client.report_exception()  # auto-captures current exception + stack trace
```

!!! tip "Structured logging for Error Reporting"
    Log exceptions as structured JSON with `severity: ERROR` and a `message` field containing the stack trace. Cloud Logging automatically forwards these to Error Reporting without any SDK dependency — useful for languages without a native Error Reporting client.

---

## Cloud Billing & Cost Controls

```hcl
resource "google_billing_budget" "prod" {
  billing_account = var.billing_account_id
  display_name    = "Production Monthly Budget"

  budget_filter {
    projects = ["projects/${data.google_project.prod.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "5000"
    }
  }

  threshold_rules { threshold_percent = 0.8 }
  threshold_rules { threshold_percent = 1.0 }
  threshold_rules { threshold_percent = 1.2; spend_basis = "FORECASTED_SPEND" }

  all_updates_rule {
    pubsub_topic = google_pubsub_topic.budget_alerts.id
  }
}
```

---

[← GCP Overview](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
