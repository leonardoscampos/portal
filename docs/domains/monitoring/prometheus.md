---
title: Prometheus
description: Coleta de métricas, PromQL, regras de gravação, Prometheus Operator, federação e remote write.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / prometheus</span>
    <h1 class="dph-title">Prometheus</h1>
    <p class="dph-desc">O padrão de fato para métricas em ambientes cloud-native. O Prometheus coleta métricas de séries temporais via pull, avalia regras de alerta e gravação, e integra-se com um rico ecossistema de exporters e o padrão Kubernetes Operator para gerenciamento de ciclo de vida.</p>
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

[← Visão Geral de Monitoramento](index.md) | [Grafana →](grafana.md)

---

## Arquitetura

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

## Instalação — Prometheus Operator (kube-prometheus-stack)

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
# ServiceMonitor — coletar de um Service com rótulo
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
# PodMonitor — coletar pods diretamente (sem Service)
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

### Seletores

```promql
# Correspondência exata
http_requests_total{job="api", status="200"}

# Correspondência com regex
http_requests_total{method=~"GET|POST"}

# Regex negativo
http_requests_total{pod!~"canary-.*"}
```

### Rate & Increase

```promql
# taxa por segundo em janela de 5 min (use rate para contadores)
rate(http_requests_total[5m])

# aumento total em 1 hora
increase(http_requests_total[1h])

# taxa em todos os pods, somada por código de status
sum by (status) (rate(http_requests_total[5m]))
```

### Agregações

```promql
# CPU média em todos os containers de um namespace
avg by (pod) (
  rate(container_cpu_usage_seconds_total{namespace="production"}[5m])
)

# Latência P99
histogram_quantile(0.99,
  sum by (le, job) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)

# Top 10 pods por uso de memória
topk(10,
  container_memory_working_set_bytes{container!="", container!="POD"}
)
```

### Funções

| Função | Uso |
|----------|-----|
| `rate(c[5m])` | Taxa por segundo do contador `c` |
| `increase(c[1h])` | Aumento do contador no intervalo |
| `irate(c[5m])` | Taxa instantânea (últimas duas amostras) |
| `delta(g[5m])` | Diferença do gauge no intervalo |
| `deriv(g[5m])` | Derivada por segundo (regressão) |
| `histogram_quantile(φ, b)` | Percentil a partir do histograma |
| `predict_linear(g[1h], 4*3600)` | Prevê valor 4 h à frente |
| `absent(m)` | Retorna 1 se `m` não tiver amostras |
| `label_replace(v, dst, rep, src, regex)` | Renomeia/transforma rótulos |

---

## Regras de Gravação

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

## Regras de Alerta

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

## Exporters Comuns

| Exporter | Métricas | Helm chart / imagem |
|----------|---------|-------------------|
| `node_exporter` | CPU, memória, disco, rede por host | `prometheus-community/prometheus-node-exporter` |
| `kube-state-metrics` | Estado de objetos Kubernetes (pods, deployments) | incluso no kube-prometheus-stack |
| `blackbox_exporter` | Sucesso de probe HTTP/TCP/ICMP + latência | `prometheus-community/prometheus-blackbox-exporter` |
| `postgres_exporter` | Atividade, locks, replicação do PostgreSQL | `prometheus-community/prometheus-postgres-exporter` |
| `redis_exporter` | Comandos, memória, keyspace do Redis | `oliver006/redis_exporter` |
| `kafka_exporter` | Lag de tópico/partição, métricas de broker | `danielqsj/kafka-exporter` |
| `mysqld_exporter` | Queries, replicação, InnoDB do MySQL | `prometheus-community/prometheus-mysql-exporter` |
| `otel-collector` | Métricas OTLP → Prometheus remote write | `open-telemetry/opentelemetry-collector` |

### Exemplo de Probe Blackbox

```yaml
# ProbeSpec — verificar URLs externas a cada 30 s
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

## Federação & Thanos

```yaml
# Thanos Sidecar — armazenamento de longo prazo via object store
# Adicionar ao prometheusSpec em values.yaml
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
# Thanos Query — visão global entre múltiplos shards do Prometheus
thanos query \
  --http-address=0.0.0.0:10902 \
  --endpoint=prometheus-0.monitoring.svc:10901 \
  --endpoint=prometheus-1.monitoring.svc:10901 \
  --endpoint=thanos-store.monitoring.svc:10901
```

!!! tip "Grafana Mimir para escalabilidade estilo SaaS"
    Mimir é um TSDB compatível com Prometheus, horizontalmente escalável e multi-tenant. Use-o em vez do Thanos quando precisar de operações mais simples: `helm install mimir grafana/mimir-distributed`.

---

## Remote Write para o Grafana Cloud

```yaml
# Em prometheusSpec.remoteWrite
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
      # Remover métricas de debug de alta cardinalidade
      - sourceLabels: [__name__]
        regex: "go_.*|process_.*"
        action: drop
```

---

## Guia Rápido de PromQL

```promql
# Utilização de CPU por nó (0–1)
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))

# Memória utilizada (bytes)
node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes

# Taxa de reinicialização de pods
rate(kube_pod_container_status_restarts_total[1h])

# Percentual de uso do PVC
(kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes) * 100

# Taxa de recebimento de rede (bytes/s)
sum by (node) (rate(node_network_receive_bytes_total{device!="lo"}[5m]))

# Nós indisponíveis no Kubelet
count(kube_node_status_condition{condition="Ready",status="true"} == 0)

# Réplicas indisponíveis em Deployment
kube_deployment_status_replicas_unavailable > 0

# HPA no máximo de réplicas (risco de saturação)
kube_horizontalpodautoscaler_status_current_replicas
  == kube_horizontalpodautoscaler_spec_max_replicas
```

[← Visão Geral de Monitoramento](index.md) | [Grafana →](grafana.md)
