---
title: Grafana
description: Dashboards, data sources, alerting, provisioning as code, Grafana Agent, and the LGTM observability stack.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / grafana</span>
    <h1 class="dph-title">Grafana</h1>
    <p class="dph-desc">The industry-standard visualization and alerting platform. Grafana queries any data source — Prometheus, Loki, Tempo, Elasticsearch, cloud databases — and renders rich dashboards, unified alerts, and on-call schedules from a single pane of glass.</p>
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

[← Prometheus](prometheus.md) | [← Monitoring Overview](index.md) | [Loki →](loki.md)

---

## Installation (Helm)

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

## Data Source Provisioning

```yaml
# ConfigMap labelled grafana_datasource=1 — auto-loaded by sidecar
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

## Dashboard Provisioning as Code

```yaml
# ConfigMap labelled grafana_dashboard=1
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
    Use [Grafonnet](https://grafana.github.io/grafonnet/index.html) (Jsonnet library) to generate dashboard JSON programmatically and store it in Git. This avoids JSON drift and enables dashboard code review.

---

## Grafana Alerting

### Alert Rule (UI-equivalent YAML)

```yaml
# Grafana alert rules are stored in its DB, but can be provisioned via ConfigMap
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

### Contact Points & Notification Policies

```yaml
# Provisioned contact points
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

## Grafana Alloy (Unified Agent)

Grafana Alloy replaces the older Grafana Agent with a River-based configuration pipeline. It collects metrics, logs, and traces.

```hcl
// alloy-config.alloy

// Discover Kubernetes pods
discovery.kubernetes "pods" {
  role = "pod"
}

// Scrape metrics from annotated pods
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

// Ship metrics to Mimir / Grafana Cloud
prometheus.remote_write "mimir" {
  endpoint {
    url = "https://mimir.internal/api/v1/push"
    basic_auth {
      username = env("MIMIR_USER")
      password = env("MIMIR_API_KEY")
    }
  }
}

// Collect logs from pods
loki.source.kubernetes "pods" {
  targets    = discovery.kubernetes.pods.targets
  forward_to = [loki.write.default.receiver]
}

loki.write "default" {
  endpoint {
    url = "https://loki.internal/loki/api/v1/push"
  }
}

// OTLP traces → Tempo
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
# Install Alloy via Helm
helm upgrade --install alloy grafana/alloy \
  --namespace monitoring \
  --set controller.type=daemonset \
  --set alloy.configMap.create=true \
  --set-file alloy.configMap.content=alloy-config.alloy
```

---

## LGTM Stack Overview

| Component | Role | Helm chart |
|-----------|------|-----------|
| **Loki** | Log aggregation + LogQL | `grafana/loki` |
| **Grafana** | Visualization + alerting | `grafana/grafana` |
| **Tempo** | Distributed tracing (OTLP) | `grafana/tempo` |
| **Mimir** | Long-term Prometheus metrics (object store) | `grafana/mimir-distributed` |
| **Alloy** | Unified collector (metrics + logs + traces) | `grafana/alloy` |
| **OnCall** | On-call scheduling + escalation (OSS) | `grafana/oncall` |

```bash
# All-in-one: Grafana Cloud k8s monitoring
helm upgrade --install k8s-monitoring grafana/k8s-monitoring \
  --namespace monitoring \
  --set cluster.name=prod \
  --set externalServices.prometheus.host=https://prometheus-prod.grafana.net \
  --set externalServices.loki.host=https://logs-prod.grafana.net \
  --set externalServices.tempo.host=https://tempo-prod.grafana.net
```

---

## Useful Dashboard IDs (Grafana.com)

| Dashboard | ID |
|-----------|----|
| Kubernetes cluster overview | 315 |
| Node Exporter Full | 1860 |
| Kubernetes / Namespace (Pods) | 6417 |
| Loki & Promtail | 10880 |
| NGINX Ingress Controller | 9614 |
| ArgoCD | 14584 |
| Cert-Manager | 11001 |
| Postgres Exporter | 9628 |

```bash
# Import via Grafana API
curl -X POST https://grafana.internal/api/dashboards/import \
  -H "Content-Type: application/json" \
  -u admin:${GRAFANA_PASSWORD} \
  -d '{"dashboard":{"id":null},"folderId":0,"overwrite":true,"inputs":[],"pluginId":"","path":"","id":1860}'
```

[← Prometheus](prometheus.md) | [← Monitoring Overview](index.md) | [Loki →](loki.md)
