---
title: Loki
description: Log aggregation with Loki, LogQL, Promtail, Grafana Alloy, log-based metrics, and retention policies.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / loki</span>
    <h1 class="dph-title">Loki</h1>
    <p class="dph-desc">Grafana Loki is a horizontally-scalable, highly-available log aggregation system inspired by Prometheus. Unlike Elasticsearch, Loki indexes only metadata labels — not log content — making it dramatically cheaper to operate at scale.</p>
    <div class="dph-badges">
      <span class="tech-badge">LogQL</span>
      <span class="tech-badge">Promtail</span>
      <span class="tech-badge">Grafana Alloy</span>
      <span class="tech-badge">Log Metrics</span>
      <span class="tech-badge">Multi-tenancy</span>
      <span class="tech-badge">Object Storage</span>
    </div>
  </div>
</div>

[← Grafana](grafana.md) | [← Monitoring Overview](index.md) | [OpenTelemetry →](opentelemetry.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                         Loki                            │
│  ┌───────────┐   ┌───────────┐   ┌──────────────────┐  │
│  │Distributor│──▶│  Ingester │──▶│  Object Storage  │  │
│  │ (ingest)  │   │  (buffer) │   │ (S3/GCS/Azure)   │  │
│  └───────────┘   └───────────┘   └──────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Querier + QueryFrontend + Ruler (LogQL, rules)   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
        ▲                               ▲
  Promtail / Alloy                  Grafana
  (tail /var/log, k8s pods)         (Explore / dashboards)
```

---

## Installation (Helm — Simple Scalable Mode)

```bash
helm repo add grafana https://grafana.github.io/helm-charts && helm repo update

helm upgrade --install loki grafana/loki \
  --namespace monitoring --create-namespace \
  --values loki-values.yaml
```

```yaml
# loki-values.yaml — Simple Scalable (write + read + backend)
deploymentMode: SimpleScalable

loki:
  auth_enabled: false          # set true for multi-tenant; use X-Scope-OrgID header

  commonConfig:
    replication_factor: 2

  storage:
    type: s3
    s3:
      endpoint: s3.us-east-1.amazonaws.com
      region: us-east-1
      bucketnames: my-loki-chunks
      s3ForcePathStyle: false
    bucketNames:
      chunks: my-loki-chunks
      ruler: my-loki-ruler
      admin: my-loki-admin

  schemaConfig:
    configs:
      - from: 2024-01-01
        store: tsdb
        object_store: s3
        schema: v13
        index:
          prefix: loki_index_
          period: 24h

  limits_config:
    retention_period: 30d
    ingestion_rate_mb: 16
    ingestion_burst_size_mb: 32
    max_streams_per_user: 10000
    max_label_names_per_series: 30
    split_queries_by_interval: 15m

write:
  replicas: 2
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { memory: 1Gi }

read:
  replicas: 2
  resources:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { memory: 1Gi }

backend:
  replicas: 2
```

---

## Promtail (Log Shipper)

```bash
helm upgrade --install promtail grafana/promtail \
  --namespace monitoring \
  --values promtail-values.yaml
```

```yaml
# promtail-values.yaml
config:
  clients:
    - url: http://loki.monitoring.svc:3100/loki/api/v1/push

  snippets:
    # Kubernetes pod logs with structured metadata
    pipelineStages:
      - cri: {}                       # parse CRI-O / containerd format
      - match:
          selector: '{namespace="production"}'
          stages:
            - json:
                expressions:
                  level: level
                  msg:   message
                  trace: traceID
            - labels:
                level:
                traceID:
            - output:
                source: msg

    # Add Kubernetes labels
    extraScrapeConfigs: |
      - job_name: kubernetes-pods
        kubernetes_sd_configs:
          - role: pod
        relabel_configs:
          - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
            action: keep
            regex: "true"
          - source_labels: [__meta_kubernetes_namespace]
            target_label: namespace
          - source_labels: [__meta_kubernetes_pod_name]
            target_label: pod
          - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
            target_label: app
          - source_labels: [__meta_kubernetes_pod_container_name]
            target_label: container
          - replacement: /var/log/pods/*$1/*.log
            separator: /
            source_labels: [__meta_kubernetes_pod_uid, __meta_kubernetes_pod_container_name]
            target_label: __path__
```

---

## Grafana Alloy — Kubernetes Logs

```hcl
// alloy log collection pipeline (preferred over Promtail for new deployments)

discovery.kubernetes "pods" {
  role = "pod"
}

discovery.relabel "pod_logs" {
  targets = discovery.kubernetes.pods.targets
  rule {
    source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
    target_label  = "app"
  }
  rule {
    source_labels = ["__meta_kubernetes_namespace"]
    target_label  = "namespace"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_name"]
    target_label  = "pod"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_container_name"]
    target_label  = "container"
  }
  rule {
    source_labels = ["__meta_kubernetes_pod_uid", "__meta_kubernetes_pod_container_name"]
    separator     = "/"
    target_label  = "__path__"
    replacement   = "/var/log/pods/*$1/*.log"
  }
}

loki.source.kubernetes "pods" {
  targets    = discovery.relabel.pod_logs.output
  forward_to = [loki.process.parse.receiver]
}

loki.process "parse" {
  // Parse JSON logs and extract fields as labels
  stage.json {
    expressions = {
      level  = "level",
      traceID = "traceID",
    }
  }
  stage.labels {
    values = {
      level   = "",
      traceID = "",
    }
  }
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "http://loki.monitoring.svc:3100/loki/api/v1/push"
  }
}
```

---

## LogQL

### Log Selector

```logql
# All logs from production namespace, app=api
{namespace="production", app="api"}

# Regex label match
{namespace=~"prod|staging", level="error"}
```

### Line Filters (fast — applied before parsing)

```logql
# Contains string
{app="api"} |= "ERROR"

# Does not contain
{app="api"} != "healthcheck"

# Regex match
{app="api"} |~ "error|panic|fatal"

# Case-insensitive regex
{app="api"} |~ "(?i)timeout"
```

### Parsers

```logql
# JSON parser — extract fields
{app="api"} | json | level="error"

# Logfmt parser
{app="worker"} | logfmt | duration > 1s

# Pattern parser (Apache Combined Log)
{app="nginx"} | pattern `<ip> - - [<ts>] "<method> <uri> <proto>" <status> <bytes>`
             | status >= 500

# Regexp parser with named capture groups
{app="api"} | regexp `level=(?P<level>\w+) msg="(?P<msg>[^"]+)"`
```

### Metric Queries

```logql
# Error rate per app (logs/s)
sum by (app) (rate({namespace="production"} |= "ERROR" [5m]))

# Request count over 10 min
sum(count_over_time({app="api"}[10m]))

# P99 latency from parsed JSON field
quantile_over_time(0.99,
  {app="api"} | json | unwrap duration_ms [5m]
) by (endpoint)

# Bytes received per pod
sum by (pod) (bytes_rate({namespace="production"}[5m]))
```

### Log-based Alerting Rule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: loki-log-alerts
  namespace: monitoring
spec:
  groups:
    - name: log.errors
      rules:
        # Convert log metric to recording rule for Alertmanager
        - alert: HighLogErrorRate
          expr: |
            sum by (app) (
              rate({namespace="production"} |= "ERROR" [5m])
            ) > 1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High error log rate in {{ $labels.app }}"
```

---

## Retention & Compaction

```yaml
# In loki.limits_config
limits_config:
  retention_period: 30d            # global default

# Per-tenant / per-stream overrides (requires auth_enabled: true)
per_tenant_override_config: /etc/loki/overrides.yaml
```

```yaml
# overrides.yaml
overrides:
  debug-team:
    retention_period: 7d
  compliance-team:
    retention_period: 365d
```

```yaml
# Enable compactor for automatic deletion
compactor:
  working_directory: /var/loki/compactor
  shared_store: s3
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150
  delete_request_cancel_period: 24h
```

---

## Loki LogQL Cheatsheet

```logql
# Last 100 error lines from all pods in production
{namespace="production"} |= "ERROR" | line_format "{{.pod}} {{.msg}}" | limit 100

# Slow requests (parsed logfmt, duration > 500ms)
{app="api"} | logfmt | duration > 500ms

# Top labels by log volume
topk(10, sum by (app) (rate({namespace="production"}[1h])))

# Trace correlation — find log lines with a specific traceID
{namespace="production"} | json | traceID="abc123def456"

# Errors in the last 15 min grouped by pod
sum by (pod) (count_over_time({namespace="production"} |= "error" [15m]))

# Kubernetes event logs
{job="eventrouter"} | json | involvedObject_namespace="production"
```

[← Grafana](grafana.md) | [← Monitoring Overview](index.md) | [OpenTelemetry →](opentelemetry.md)
