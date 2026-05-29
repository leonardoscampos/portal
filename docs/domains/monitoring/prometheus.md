---
title: Prometheus
description: Metrics collection, PromQL, recording rules, Prometheus Operator, federation and remote write.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / prometheus</span>
    <h1 class="dph-title">Prometheus</h1>
    <p class="dph-desc">The de-facto standard for metrics in cloud-native environments. Prometheus scrapes time-series metrics via pull, evaluates alerting and recording rules, and integrates with a rich ecosystem of exporters and the Kubernetes Operator pattern for lifecycle management.</p>
    <div class="dph-badges">
      <span class="tech-badge">PromQL</span>
      <span class="tech-badge">Prometheus Operator</span>
      <span class="tech-badge">Recording Rules</span>
      <span class="tech-badge">Exporters</span>
      <span class="tech-badge">Remote Write</span>
      <span class="tech-badge">Federation</span>
    </div>
  </div>
</div>

[← Monitoring Overview](index.md) | [Grafana →](grafana.md)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Prometheus                        │
│  ┌──────────────┐   ┌──────────────┐                │
│  │ Scrape engine│   │  TSDB        │                │
│  │  (pull)      │   │  (local)     │                │
│  └──────┬───────┘   └──────┬───────┘                │
│         │                  │ remote_write           │
└─────────┼──────────────────┼────────────────────────┘
          │ /metrics          ▼
   ┌──────▼──────┐     ┌─────────────┐
   │  Exporters  │     │  Thanos /   │
   │  (node,kube)│     │  Cortex /   │
   └─────────────┘     │  Mimir      │
                       └─────────────┘
         ▼
   ┌─────────────┐
   │  Alertmanager│
   └─────────────┘
```

---

## Installation — Prometheus Operator (kube-prometheus-stack)

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --values values.yaml
```

```yaml
# values.yaml — production-grade defaults
prometheus:
  prometheusSpec:
    retention: 15d
    retentionSize: "40GB"
    replicas: 2
    shards: 1

    resources:
      requests: { cpu: 500m, memory: 2Gi }
      limits:   { memory: 4Gi }

    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 50Gi

    # Scrape all ServiceMonitors/PodMonitors in the cluster
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false
    ruleSelectorNilUsesHelmValues: false

    # Remote write to long-term storage
    remoteWrite:
      - url: https://mimir.internal/api/v1/push
        headers:
          X-Scope-OrgID: prod
        queueConfig:
          capacity: 10000
          maxSamplesPerSend: 5000
          batchSendDeadline: 5s

alertmanager:
  alertmanagerSpec:
    replicas: 2
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 5Gi

grafana:
  adminPassword: "${GRAFANA_PASSWORD}"
  persistence:
    enabled: true
    storageClassName: gp3
    size: 10Gi

nodeExporter:
  enabled: true

kubeStateMetrics:
  enabled: true
```

---

## ServiceMonitor & PodMonitor

```yaml
# ServiceMonitor — scrape a labelled Service
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: app-metrics
  namespace: monitoring
  labels:
    release: kube-prometheus-stack        # must match prometheusSpec.serviceMonitorSelector
spec:
  namespaceSelector:
    matchNames: [production]
  selector:
    matchLabels:
      app.kubernetes.io/name: my-app
  endpoints:
    - port: metrics
      path: /metrics
      interval: 30s
      scrapeTimeout: 10s
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_name]
          targetLabel: pod
```

```yaml
# PodMonitor — scrape pods directly (no Service required)
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: batch-jobs
  namespace: monitoring
spec:
  namespaceSelector:
    matchNames: [production]
  selector:
    matchLabels:
      role: batch
  podMetricsEndpoints:
    - port: metrics
      interval: 60s
```

---

## PromQL

### Selectors

```promql
# Exact match
http_requests_total{job="api", status="200"}

# Regex match
http_requests_total{method=~"GET|POST"}

# Negative regex
http_requests_total{pod!~"canary-.*"}
```

### Rate & Increase

```promql
# per-second rate over 5-min window (use rate for counters)
rate(http_requests_total[5m])

# total increase over 1 hour
increase(http_requests_total[1h])

# rate across all pods, summed by status code
sum by (status) (rate(http_requests_total[5m]))
```

### Aggregations

```promql
# Average CPU across all containers in a namespace
avg by (pod) (
  rate(container_cpu_usage_seconds_total{namespace="production"}[5m])
)

# P99 latency
histogram_quantile(0.99,
  sum by (le, job) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)

# Top 10 pods by memory usage
topk(10,
  container_memory_working_set_bytes{container!="", container!="POD"}
)
```

### Functions

| Function | Use |
|----------|-----|
| `rate(c[5m])` | Per-second rate of counter `c` |
| `increase(c[1h])` | Counter increase over range |
| `irate(c[5m])` | Instantaneous rate (last two samples) |
| `delta(g[5m])` | Difference of gauge over range |
| `deriv(g[5m])` | Per-second derivative (regression) |
| `histogram_quantile(φ, b)` | Percentile from histogram |
| `predict_linear(g[1h], 4*3600)` | Predict value 4 h ahead |
| `absent(m)` | Returns 1 if `m` has no samples |
| `label_replace(v, dst, rep, src, regex)` | Rename/transform labels |

---

## Recording Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: app-recording-rules
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
spec:
  groups:
    - name: app.requests
      interval: 30s
      rules:
        # Pre-compute request rate per job/status
        - record: job:http_requests:rate5m
          expr: |
            sum by (job, status) (
              rate(http_requests_total[5m])
            )

        # Error ratio
        - record: job:http_error_ratio:rate5m
          expr: |
            sum by (job) (rate(http_requests_total{status=~"5.."}[5m]))
            /
            sum by (job) (rate(http_requests_total[5m]))

    - name: app.latency
      interval: 30s
      rules:
        - record: job:http_request_duration_p99:rate5m
          expr: |
            histogram_quantile(0.99,
              sum by (job, le) (
                rate(http_request_duration_seconds_bucket[5m])
              )
            )
```

---

## Alerting Rules

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: app-alerts
  namespace: monitoring
  labels:
    release: kube-prometheus-stack
spec:
  groups:
    - name: app.availability
      rules:
        - alert: HighErrorRate
          expr: job:http_error_ratio:rate5m > 0.05
          for: 5m
          labels:
            severity: critical
            team: backend
          annotations:
            summary: "High error rate on {{ $labels.job }}"
            description: "Error rate is {{ $value | humanizePercentage }} (threshold 5%)"
            runbook_url: "https://wiki.internal/runbooks/high-error-rate"

        - alert: HighLatencyP99
          expr: job:http_request_duration_p99:rate5m > 1.0
          for: 10m
          labels:
            severity: warning
            team: backend
          annotations:
            summary: "P99 latency above 1 s on {{ $labels.job }}"
            description: "P99 = {{ $value | humanizeDuration }}"

        - alert: PodCrashLooping
          expr: |
            increase(kube_pod_container_status_restarts_total[15m]) > 3
          for: 0m
          labels:
            severity: critical
          annotations:
            summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} is crash-looping"

        - alert: NodeDiskWillFillIn4h
          expr: |
            predict_linear(node_filesystem_free_bytes{mountpoint="/"}[1h], 4*3600) < 0
          for: 30m
          labels:
            severity: warning
          annotations:
            summary: "Disk on {{ $labels.instance }} will fill in < 4 h"
```

---

## Common Exporters

| Exporter | Metrics | Helm chart / image |
|----------|---------|-------------------|
| `node_exporter` | CPU, memory, disk, network per host | `prometheus-community/prometheus-node-exporter` |
| `kube-state-metrics` | Kubernetes object state (pods, deployments) | bundled in kube-prometheus-stack |
| `blackbox_exporter` | HTTP/TCP/ICMP probe success + latency | `prometheus-community/prometheus-blackbox-exporter` |
| `postgres_exporter` | PostgreSQL activity, locks, replication | `prometheus-community/prometheus-postgres-exporter` |
| `redis_exporter` | Redis commands, memory, keyspace | `oliver006/redis_exporter` |
| `kafka_exporter` | Topic / partition lag, broker metrics | `danielqsj/kafka-exporter` |
| `mysqld_exporter` | MySQL queries, replication, InnoDB | `prometheus-community/prometheus-mysql-exporter` |
| `otel-collector` | OTLP metrics → Prometheus remote write | `open-telemetry/opentelemetry-collector` |

### Blackbox Probe Example

```yaml
# ProbeSpec — check external URLs every 30 s
apiVersion: monitoring.coreos.com/v1
kind: Probe
metadata:
  name: external-endpoints
  namespace: monitoring
spec:
  jobName: external-http
  interval: 30s
  module: http_2xx
  prober:
    url: blackbox-exporter.monitoring.svc:9115
  targets:
    staticConfig:
      static:
        - https://api.example.com/health
        - https://app.example.com
```

---

## Federation & Thanos

```yaml
# Thanos Sidecar — long-term storage via object store
# Add to prometheusSpec in values.yaml
thanos:
  image: quay.io/thanos/thanos:v0.36.1
  objectStorageConfig:
    secret:
      type: S3
      config:
        bucket: my-thanos-bucket
        endpoint: s3.us-east-1.amazonaws.com
        region: us-east-1
```

```bash
# Thanos Query — global view across multiple Prometheus shards
thanos query \
  --http-address=0.0.0.0:10902 \
  --endpoint=prometheus-0.monitoring.svc:10901 \
  --endpoint=prometheus-1.monitoring.svc:10901 \
  --endpoint=thanos-store.monitoring.svc:10901
```

!!! tip "Grafana Mimir for SaaS-style scaling"
    Mimir is a horizontally scalable, multi-tenant Prometheus-compatible TSDB. Use it instead of Thanos when you need simpler operations: `helm install mimir grafana/mimir-distributed`.

---

## Remote Write to Grafana Cloud

```yaml
# In prometheusSpec.remoteWrite
remoteWrite:
  - url: https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/push
    basicAuth:
      username:
        name: grafana-cloud-secret
        key: username
      password:
        name: grafana-cloud-secret
        key: apiKey
    writeRelabelConfigs:
      # Drop high-cardinality debug metrics
      - sourceLabels: [__name__]
        regex: "go_.*|process_.*"
        action: drop
```

---

## PromQL Cheatsheet

```promql
# CPU utilisation per node (0–1)
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

# Memory used (bytes)
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# Pod restart rate
rate(kube_pod_container_status_restarts_total[1h])

# PVC usage percentage
(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) * 100

# Network receive rate (bytes/s)
sum by (node) (rate(node_network_receive_bytes_total{device!="lo"}[5m]))

# Kubelet unavailable nodes
count(kube_node_status_condition{condition="Ready",status="true"} == 0)

# Deployment unavailable replicas
kube_deployment_status_replicas_unavailable > 0

# HPA at max replicas (risk of saturation)
kube_horizontalpodautoscaler_status_current_replicas
  == kube_horizontalpodautoscaler_spec_max_replicas
```

[← Monitoring Overview](index.md) | [Grafana →](grafana.md)
