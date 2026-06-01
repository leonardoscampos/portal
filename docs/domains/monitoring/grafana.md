---
title: Grafana
description: Painéis, fontes de dados, alertas, provisionamento como código, Grafana Agent e a stack de observabilidade LGTM.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / grafana</span>
    <h1 class="dph-title">Grafana</h1>
    <p class="dph-desc">A plataforma padrão do setor para visualização e alertas. O Grafana consulta qualquer fonte de dados — Prometheus, Loki, Tempo, Elasticsearch, bancos de dados em nuvem — e renderiza painéis ricos, alertas unificados e escalas de plantão a partir de um único painel de controle.</p>
    <div class="dph-badges">
      <span class="tech-badge">Dashboards</span>
      <span class="tech-badge">Data Sources</span>
      <span class="tech-badge">Alerting</span>
      <span class="tech-badge">Provisioning</span>
      <span class="tech-badge">Grafana Agent</span>
      <span class="tech-badge">LGTM Stack</span>
    </div>
  </div>
</div>

[← Prometheus](prometheus.md) | [← Visão Geral de Monitoramento](index.md) | [Loki →](loki.md)

---

## Instalação (Helm)

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

helm upgrade --install grafana grafana/grafana \
  --namespace monitoring --create-namespace \
  --values grafana-values.yaml
```

```yaml
# grafana-values.yaml
replicas: 2

persistence:
  enabled: true
  storageClassName: gp3
  size: 10Gi

adminUser: admin
adminPassword: "${GRAFANA_ADMIN_PASSWORD}"  # use a Secret in production

env:
  GF_SERVER_ROOT_URL: https://grafana.internal
  GF_AUTH_GENERIC_OAUTH_ENABLED: "true"

ingress:
  enabled: true
  ingressClassName: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - grafana.internal
  tls:
    - secretName: grafana-tls
      hosts: [grafana.internal]

# Sidecar auto-loads ConfigMap-provisioned dashboards
sidecar:
  dashboards:
    enabled: true
    label: grafana_dashboard
    labelValue: "1"
    folder: /var/lib/grafana/dashboards
    searchNamespace: ALL
  datasources:
    enabled: true
    label: grafana_datasource
    labelValue: "1"

resources:
  requests: { cpu: 200m, memory: 256Mi }
  limits:   { memory: 512Mi }
```

---

## Provisionamento de Fontes de Dados

```yaml
# ConfigMap com rótulo grafana_datasource=1 — carregado automaticamente pelo sidecar
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: monitoring
  labels:
    grafana_datasource: "1"
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        uid: prometheus
        url: http://kube-prometheus-stack-prometheus.monitoring.svc:9090
        access: proxy
        isDefault: true
        jsonData:
          timeInterval: 30s
          httpMethod: POST
          exemplarTraceIdDestinations:
            - name: traceID
              datasourceUid: tempo

      - name: Loki
        type: loki
        uid: loki
        url: http://loki.monitoring.svc:3100
        access: proxy
        jsonData:
          derivedFields:
            - datasourceUid: tempo
              matcherRegex: "traceID=(\\w+)"
              name: TraceID
              url: "${__value.raw}"

      - name: Tempo
        type: tempo
        uid: tempo
        url: http://tempo.monitoring.svc:3200
        access: proxy
        jsonData:
          nodeGraph:
            enabled: true
          serviceMap:
            datasourceUid: prometheus
          lokiSearch:
            datasourceUid: loki
```

---

## Provisionamento de Painéis como Código

```yaml
# ConfigMap com rótulo grafana_dashboard=1
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-dashboard
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  app-dashboard.json: |
    {
      "title": "Application Overview",
      "uid": "app-overview",
      "tags": ["app", "production"],
      "refresh": "30s",
      "panels": [
        {
          "title": "Request Rate",
          "type": "timeseries",
          "datasource": { "uid": "prometheus" },
          "targets": [{
            "expr": "sum by (status) (rate(http_requests_total[5m]))",
            "legendFormat": "{{status}}"
          }]
        },
        {
          "title": "P99 Latency",
          "type": "gauge",
          "datasource": { "uid": "prometheus" },
          "targets": [{
            "expr": "histogram_quantile(0.99, sum by(le)(rate(http_request_duration_seconds_bucket[5m])))",
            "legendFormat": "P99"
          }],
          "options": {
            "reduceOptions": { "calcs": ["lastNotNull"] }
          }
        }
      ]
    }
```

!!! tip "Grafonnet"
    Use o [Grafonnet](https://grafana.github.io/grafonnet/index.html) (biblioteca Jsonnet) para gerar o JSON do painel de forma programática e armazená-lo no Git. Isso evita a deriva do JSON e habilita revisão de código dos painéis.

---

## Alertas no Grafana

### Regra de Alerta (YAML equivalente à UI)

```yaml
# Regras de alerta do Grafana ficam no banco de dados, mas podem ser provisionadas via ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-alert-rules
  namespace: monitoring
  labels:
    grafana_alert: "1"
data:
  app-alerts.yaml: |
    apiVersion: 1
    groups:
      - orgId: 1
        name: app-availability
        folder: App Alerts
        interval: 1m
        rules:
          - uid: high-error-rate
            title: High Error Rate
            condition: C
            data:
              - refId: A
                relativeTimeRange: { from: 300, to: 0 }
                datasourceUid: prometheus
                model:
                  expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))
              - refId: C
                datasourceUid: "-100"
                model:
                  conditions:
                    - evaluator: { params: [0.05], type: gt }
                      query: { params: [A] }
            noDataState: NoData
            execErrState: Error
            for: 5m
            labels:
              severity: critical
            annotations:
              summary: "Error rate above 5%"
              runbook_url: "https://wiki.internal/runbooks/high-error-rate"
```

### Pontos de Contato e Políticas de Notificação

```yaml
# Pontos de contato provisionados
apiVersion: 1
contactPoints:
  - orgId: 1
    name: PagerDuty Critical
    receivers:
      - uid: pagerduty-critical
        type: pagerduty
        settings:
          integrationKey: "${PD_INTEGRATION_KEY}"
          severity: critical
          class: "{{ .CommonLabels.alertname }}"
          component: "{{ .CommonLabels.job }}"
          group: "{{ .CommonLabels.namespace }}"

  - orgId: 1
    name: Slack Warnings
    receivers:
      - uid: slack-warnings
        type: slack
        settings:
          url: "${SLACK_WEBHOOK_URL}"
          channel: "#alerts-warning"
          title: |
            {{ .CommonLabels.alertname }} — {{ .CommonLabels.severity }}
          text: |
            {{ range .Alerts }}
            *{{ .Annotations.summary }}*
            {{ .Annotations.description }}
            {{ end }}

policies:
  - orgId: 1
    receiver: Slack Warnings
    routes:
      - receiver: PagerDuty Critical
        matchers:
          - severity = critical
        continue: false
      - receiver: Slack Warnings
        matchers:
          - severity = warning
```

---

## Grafana Alloy (Agente Unificado)

O Grafana Alloy substitui o antigo Grafana Agent com um pipeline de configuração baseado em River. Ele coleta métricas, logs e traces.

```hcl
// alloy-config.alloy

// Descobrir pods Kubernetes
discovery.kubernetes "pods" {
  role = "pod"
}

// Coletar métricas de pods com anotações
prometheus.scrape "pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [prometheus.remote_write.mimir.receiver]

  relabeling_rules {
    rule {
      source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_scrape"]
      regex         = "true"
      action        = "keep"
    }
    rule {
      source_labels = ["__meta_kubernetes_pod_annotation_prometheus_io_path"]
      target_label  = "__metrics_path__"
    }
  }
}

// Enviar métricas para Mimir / Grafana Cloud
prometheus.remote_write "mimir" {
  endpoint {
    url = "https://mimir.internal/api/v1/push"
    basic_auth {
      username = env("MIMIR_USER")
      password = env("MIMIR_API_KEY")
    }
  }
}

// Coletar logs dos pods
loki.source.kubernetes "pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "https://loki.internal/loki/api/v1/push"
  }
}

// Traces OTLP → Tempo
otelcol.receiver.otlp "default" {
  grpc { endpoint = "0.0.0.0:4317" }
  http { endpoint = "0.0.0.0:4318" }
  output {
    traces = [otelcol.exporter.otlphttp.tempo.input]
  }
}

otelcol.exporter.otlphttp "tempo" {
  client {
    endpoint = "http://tempo.monitoring.svc:4318"
  }
}
```

```bash
# Instalar Alloy via Helm
helm upgrade --install alloy grafana/alloy \
  --namespace monitoring \
  --set controller.type=daemonset \
  --set alloy.configMap.create=true \
  --set-file alloy.configMap.content=alloy-config.alloy
```

---

## Visão Geral da Stack LGTM

| Componente | Papel | Helm chart |
|-----------|------|-----------|
| **Loki** | Agregação de logs + LogQL | `grafana/loki` |
| **Grafana** | Visualização + alertas | `grafana/grafana` |
| **Tempo** | Rastreamento distribuído (OTLP) | `grafana/tempo` |
| **Mimir** | Métricas Prometheus de longo prazo (object store) | `grafana/mimir-distributed` |
| **Alloy** | Coletor unificado (métricas + logs + traces) | `grafana/alloy` |
| **OnCall** | Agendamento de plantão + escalação (OSS) | `grafana/oncall` |

```bash
# Tudo-em-um: monitoramento k8s Grafana Cloud
helm upgrade --install k8s-monitoring grafana/k8s-monitoring \
  --namespace monitoring \
  --set cluster.name=prod \
  --set externalServices.prometheus.host=https://prometheus-prod.grafana.net \
  --set externalServices.loki.host=https://logs-prod.grafana.net \
  --set externalServices.tempo.host=https://tempo-prod.grafana.net
```

---

## IDs de Painéis Úteis (Grafana.com)

| Painel | ID |
|-----------|----|
| Visão geral do cluster Kubernetes | 315 |
| Node Exporter Full | 1860 |
| Kubernetes / Namespace (Pods) | 6417 |
| Loki & Promtail | 10880 |
| NGINX Ingress Controller | 9614 |
| ArgoCD | 14584 |
| Cert-Manager | 11001 |
| Postgres Exporter | 9628 |

```bash
# Importar via API do Grafana
curl -X POST https://grafana.internal/api/dashboards/import \
  -H "Content-Type: application/json" \
  -u admin:${GRAFANA_PASSWORD} \
  -d '{"dashboard":{"id":null},"folderId":0,"overwrite":true,"inputs":[],"pluginId":"","path":"","id":1860}'
```

[← Prometheus](prometheus.md) | [← Visão Geral de Monitoramento](index.md) | [Loki →](loki.md)
