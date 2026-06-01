---
title: Datadog
description: Datadog APM, monitoramento de infraestrutura, gerenciamento de logs, painéis, SLOs e alertas para plataformas cloud-native.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / datadog</span>
    <h1 class="dph-title">Datadog</h1>
    <p class="dph-desc">Datadog é uma plataforma de observabilidade unificada que abrange métricas de infraestrutura, traces APM, gerenciamento de logs, monitoramento de usuário real e testes sintéticos — tudo correlacionado em um único painel. O Datadog Agent é implantado como DaemonSet e integra-se a todos os provedores de nuvem e runtimes.</p>
    <div class="dph-badges">
      <span class="tech-badge">Datadog Agent</span>
      <span class="tech-badge">APM</span>
      <span class="tech-badge">Gerenciamento de Logs</span>
      <span class="tech-badge">Painéis</span>
      <span class="tech-badge">SLOs</span>
      <span class="tech-badge">Monitores</span>
    </div>
  </div>
</div>

[← APM](apm.md) | [← Visão Geral de Monitoramento](index.md) | [Dynatrace →](dynatrace.md)

---

## Implantação do Agent (Kubernetes)

```bash
helm repo add datadog https://helm.datadoghq.com
helm repo update

helm upgrade --install datadog datadog/datadog \
  --namespace datadog --create-namespace \
  --values datadog-values.yaml
```

```yaml
# datadog-values.yaml
datadog:
  apiKeyExistingSecret: datadog-secret   # kubectl create secret generic datadog-secret --from-literal=api-key=$DD_API_KEY
  appKeyExistingSecret: datadog-secret

  site: datadoghq.com                    # or datadoghq.eu

  # Cluster-level metadata
  clusterName: prod-cluster
  env: production

  # Infrastructure
  collectEvents: true
  leaderElection: true

  # APM
  apm:
    portEnabled: true
    port: 8126

  # Log collection
  logs:
    enabled: true
    containerCollectAll: true
    containerCollectUsingFiles: true

  # Process monitoring
  processAgent:
    enabled: true
    processCollection: true

  # Network performance monitoring
  networkMonitoring:
    enabled: true

  # Security (CSPM / CWS)
  securityAgent:
    compliance:
      enabled: true
    runtime:
      enabled: true

# DaemonSet — one agent per node
agents:
  tolerations:
    - operator: Exists

# Cluster Agent — single deployment
clusterAgent:
  enabled: true
  replicas: 2
  metricsProvider:
    enabled: true     # HPA based on Datadog metrics

# Kube state metrics
kubeStateMetricsEnabled: true
kubeStateMetricsCore:
  enabled: true
```

---

## APM — Rastreamento Distribuído

### Instrumentar Python

```python
# Install: pip install ddtrace
from ddtrace import tracer, patch_all

patch_all()   # auto-instrument: requests, psycopg2, redis, celery, etc.

# Manual span
with tracer.trace("my_operation", service="my-api", resource="GET /users") as span:
    span.set_tag("user.id", user_id)
    span.set_tag("db.query", query)
    result = db.query(query)
    span.set_metric("result.count", len(result))
```

```bash
# Run with ddtrace-run (zero-code change)
DD_SERVICE=my-api \
DD_ENV=production \
DD_VERSION=1.2.3 \
DD_AGENT_HOST=datadog-agent.datadog.svc \
ddtrace-run gunicorn app:app
```

### Instrumentar Go

```go
import (
    "gopkg.in/DataDog/dd-trace-go.v1/ddtrace/tracer"
    httptrace "gopkg.in/DataDog/dd-trace-go.v1/contrib/net/http"
)

func main() {
    tracer.Start(
        tracer.WithService("my-api"),
        tracer.WithEnv("production"),
        tracer.WithServiceVersion("1.2.3"),
        tracer.WithAgentAddr("datadog-agent.datadog.svc:8126"),
    )
    defer tracer.Stop()

    // Instrumented HTTP router
    mux := httptrace.NewServeMux()
    mux.HandleFunc("/users", handleUsers)
    http.ListenAndServe(":8080", mux)
}
```

### Instrumentar Node.js

```javascript
// Must be first import
const tracer = require('dd-trace').init({
  service: 'my-api',
  env: 'production',
  version: process.env.DD_VERSION,
  logInjection: true,    // injects trace_id into log lines
  runtimeMetrics: true,
});
```

### Anotações de Pod no Kubernetes (Injeção de Biblioteca)

```yaml
# Let Datadog inject the tracer library — no code change required
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
spec:
  template:
    metadata:
      labels:
        tags.datadoghq.com/env: production
        tags.datadoghq.com/service: my-api
        tags.datadoghq.com/version: "1.2.3"
      annotations:
        admission.datadoghq.com/enabled: "true"
        admission.datadoghq.com/python-lib.version: "v2"  # or java-lib / js-lib / dotnet-lib
    spec:
      containers:
        - name: my-api
          env:
            - name: DD_AGENT_HOST
              valueFrom:
                fieldRef:
                  fieldPath: status.hostIP
```

---

## Gerenciamento de Logs

### Coleta de Logs de Pods

```yaml
# Autodiscovery annotations — override log parsing per pod
metadata:
  annotations:
    ad.datadoghq.com/my-api.logs: |
      [{
        "source": "python",
        "service": "my-api",
        "log_processing_rules": [{
          "type": "multi_line",
          "name": "stack_trace",
          "pattern": "Traceback|^\\s+File"
        }]
      }]
```

### Pipeline de Logs (Terraform)

```hcl
resource "datadog_logs_index" "main" {
  name            = "main"
  daily_limit     = 300000000
  retention_days  = 15

  filter {
    query = "*"
  }

  exclusion_filter {
    name       = "drop-health-checks"
    is_enabled = true
    filter {
      query       = "service:my-api @http.url_details.path:/health"
      sample_rate = 1.0
    }
  }
}

resource "datadog_logs_pipeline" "my_api" {
  name       = "my-api pipeline"
  is_enabled = true
  filter { query = "service:my-api" }

  processor {
    grok_parser {
      name       = "Parse HTTP logs"
      is_enabled = true
      source     = "message"
      grok {
        support_rules = ""
        match_rules   = "http_rule %{ip:network.client.ip} - - \\[%{date(\"dd/MMM/yyyy:HH:mm:ss Z\"):http.date}\\] \"%{word:http.method} %{notSpace:http.url} HTTP/%{number:http.version}\" %{integer:http.status_code} %{integer:network.bytes_written}"
      }
    }
  }

  processor {
    status_remapper {
      name       = "Map http.status_code to log status"
      is_enabled = true
      sources    = ["http.status_code"]
    }
  }
}
```

---

## Monitores & Alertas

### Monitores Gerenciados com Terraform

```hcl
# Error rate monitor
resource "datadog_monitor" "api_error_rate" {
  name    = "API Error Rate High — ${var.service}"
  type    = "metric alert"
  message = <<-EOT
    **Error rate exceeded 5% on {{service.name}}**
    Current: {{value}}%
    @pagerduty-prod-alerts
  EOT

  query = "sum(last_5m):sum:trace.web.request.errors{service:my-api,env:production}.as_rate() / sum:trace.web.request.hits{service:my-api,env:production}.as_rate() * 100 > 5"

  monitor_thresholds {
    critical          = 5
    critical_recovery = 2
    warning           = 2
    warning_recovery  = 1
  }

  notify_no_data    = true
  no_data_timeframe = 10
  evaluation_delay  = 60

  tags = ["service:my-api", "env:production", "team:backend"]
}

# Anomaly detection monitor
resource "datadog_monitor" "latency_anomaly" {
  name = "Latency Anomaly — ${var.service}"
  type = "metric alert"

  query = "avg(last_4h):anomalies(avg:trace.web.request.duration{service:my-api,env:production}, 'basic', 2, direction='above', alert_window='last_15m', interval=60, count_default_zero='true') >= 1"

  message = "Latency anomaly detected on {{service.name}} @slack-sre-alerts"

  monitor_thresholds {
    critical = 1
  }
}
```

---

## Painéis como Código

```hcl
resource "datadog_dashboard" "service_overview" {
  title       = "My API — Service Overview"
  layout_type = "ordered"
  reflow_type = "fixed"

  widget {
    timeseries_definition {
      title = "Request Rate"
      request {
        q            = "sum:trace.web.request.hits{service:my-api,env:production}.as_rate()"
        display_type = "line"
        style {
          palette    = "dog_classic"
          line_type  = "solid"
          line_width = "normal"
        }
      }
      yaxis { scale = "linear" }
    }
  }

  widget {
    query_value_definition {
      title     = "P99 Latency (ms)"
      precision = 0
      request {
        q          = "p99:trace.web.request.duration{service:my-api,env:production} * 1000"
        aggregator = "last"
        conditional_formats {
          comparator = ">"
          value      = 500
          palette    = "white_on_red"
        }
        conditional_formats {
          comparator = "<"
          value      = 200
          palette    = "white_on_green"
        }
      }
    }
  }
}
```

---

## SLOs

```hcl
resource "datadog_service_level_objective" "api_availability" {
  name        = "My API — Availability"
  type        = "metric"
  description = "99.9% of requests succeed (non-5xx)"

  query {
    numerator   = "sum:trace.web.request.hits{service:my-api,env:production,!http.status_class:5xx}.as_count()"
    denominator = "sum:trace.web.request.hits{service:my-api,env:production}.as_count()"
  }

  thresholds {
    timeframe       = "30d"
    target          = 99.9
    warning         = 99.95
  }

  tags = ["service:my-api", "env:production"]
}
```

---

## Testes Sintéticos

```hcl
# API test — run from multiple locations every minute
resource "datadog_synthetics_test" "api_health" {
  type    = "api"
  subtype = "http"
  name    = "My API — Health Check"
  status  = "live"

  request_definition {
    method = "GET"
    url    = "https://api.example.com/health"
  }

  assertion {
    type     = "statusCode"
    operator = "is"
    target   = "200"
  }
  assertion {
    type     = "responseTime"
    operator = "lessThan"
    target   = "500"
  }
  assertion {
    type     = "body"
    operator = "contains"
    target   = "\"status\":\"ok\""
  }

  locations = ["aws:us-east-1", "aws:eu-west-1", "aws:ap-southeast-1"]

  options_list {
    tick_every = 60

    retry {
      count    = 2
      interval = 300
    }

    monitor_options {
      renotify_interval = 120
    }
  }
}
```

[← APM](apm.md) | [← Visão Geral de Monitoramento](index.md) | [Dynatrace →](dynatrace.md)
