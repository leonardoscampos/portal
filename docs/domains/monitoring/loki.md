---
title: Loki
description: Agregação de logs com Loki, LogQL, Promtail, Grafana Alloy, métricas baseadas em logs e políticas de retenção.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / loki</span>
    <h1 class="dph-title">Loki</h1>
    <p class="dph-desc">O Grafana Loki é um sistema de agregação de logs horizontalmente escalável e de alta disponibilidade, inspirado no Prometheus. Ao contrário do Elasticsearch, o Loki indexa apenas rótulos de metadados — e não o conteúdo dos logs — tornando-o dramaticamente mais barato de operar em escala.</p>
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

[← Grafana](grafana.md) | [← Visão Geral de Monitoramento](index.md) | [OpenTelemetry →](opentelemetry.md)

---

## Arquitetura

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

## Instalação (Helm — Modo Simple Scalable)

```bash
helm repo add grafana https://grafana.github.io/helm-charts && helm repo update

helm upgrade --install loki grafana/loki \
  --namespace monitoring --create-namespace \
  --values loki-values.yaml
```

```yaml
# loki-values.yaml — Simple Scalable (escrita + leitura + backend)
deploymentMode: SimpleScalable

loki:
  auth_enabled: false          # defina como true para multi-tenant; use o header X-Scope-OrgID

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

## Promtail (Transportador de Logs)

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
    # Logs de pods Kubernetes com metadados estruturados
    pipelineStages:
      - cri: {}                       # analisa o formato CRI-O / containerd
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

    # Adiciona rótulos do Kubernetes
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

## Grafana Alloy — Logs do Kubernetes

```hcl
// pipeline de coleta de logs do Alloy (preferido ao Promtail para novas implantações)

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
  // Analisa logs JSON e extrai campos como rótulos
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

### Seletor de Log

```logql
# Todos os logs do namespace production, app=api
{namespace="production", app="api"}

# Correspondência de rótulo por regex
{namespace=~"prod|staging", level="error"}
```

### Filtros de Linha (rápidos — aplicados antes da análise)

```logql
# Contém string
{app="api"} |= "ERROR"

# Não contém
{app="api"} != "healthcheck"

# Correspondência por regex
{app="api"} |~ "error|panic|fatal"

# Regex sem distinção de maiúsculas
{app="api"} |~ "(?i)timeout"
```

### Analisadores

```logql
# Analisador JSON — extrai campos
{app="api"} | json | level="error"

# Analisador Logfmt
{app="worker"} | logfmt | duration > 1s

# Analisador de padrão (Apache Combined Log)
{app="nginx"} | pattern `<ip> - - [<ts>] "<method> <uri> <proto>" <status> <bytes>`
             | status >= 500

# Analisador Regexp com grupos de captura nomeados
{app="api"} | regexp `level=(?P<level>\w+) msg="(?P<msg>[^"]+)"`
```

### Consultas de Métricas

```logql
# Taxa de erro por app (logs/s)
sum by (app) (rate({namespace="production"} |= "ERROR" [5m]))

# Contagem de requisições em 10 min
sum(count_over_time({app="api"}[10m]))

# Latência P99 a partir de campo JSON analisado
quantile_over_time(0.99,
  {app="api"} | json | unwrap duration_ms [5m]
) by (endpoint)

# Bytes recebidos por pod
sum by (pod) (bytes_rate({namespace="production"}[5m]))
```

### Regra de Alerta Baseada em Logs

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
        # Converte métrica de log em recording rule para o Alertmanager
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

## Retenção e Compactação

```yaml
# Em loki.limits_config
limits_config:
  retention_period: 30d            # padrão global

# Sobrescritas por tenant / por stream (requer auth_enabled: true)
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
# Habilita compactor para exclusão automática
compactor:
  working_directory: /var/loki/compactor
  shared_store: s3
  retention_enabled: true
  retention_delete_delay: 2h
  retention_delete_worker_count: 150
  delete_request_cancel_period: 24h
```

---

## Cheatsheet de LogQL do Loki

```logql
# Últimas 100 linhas de erro de todos os pods em production
{namespace="production"} |= "ERROR" | line_format "{{.pod}} {{.msg}}" | limit 100

# Requisições lentas (logfmt analisado, duração > 500ms)
{app="api"} | logfmt | duration > 500ms

# Top rótulos por volume de logs
topk(10, sum by (app) (rate({namespace="production"}[1h])))

# Correlação de traces — encontra linhas de log com um traceID específico
{namespace="production"} | json | traceID="abc123def456"

# Erros nos últimos 15 min agrupados por pod
sum by (pod) (count_over_time({namespace="production"} |= "error" [15m]))

# Logs de eventos do Kubernetes
{job="eventrouter"} | json | involvedObject_namespace="production"
```

[← Grafana](grafana.md) | [← Visão Geral de Monitoramento](index.md) | [OpenTelemetry →](opentelemetry.md)
