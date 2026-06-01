---
title: Dynatrace
description: Dynatrace full-stack observability — OneAgent, Davis AI, Smartscape, distributed tracing, log management, infrastructure monitoring and SLOs.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / dynatrace</span>
    <h1 class="dph-title">Dynatrace</h1>
    <p class="dph-desc">Dynatrace delivers AI-powered full-stack observability through a single OneAgent deployment. Davis AI automatically detects anomalies, pinpoints root causes and maps every dependency in real time via Smartscape — replacing manual dashboard review with causal answers.</p>
    <div class="dph-badges">
      <span class="tech-badge">OneAgent</span>
      <span class="tech-badge">Davis AI</span>
      <span class="tech-badge">Smartscape</span>
      <span class="tech-badge">DQL</span>
      <span class="tech-badge">SLOs</span>
      <span class="tech-badge">OpenTelemetry</span>
    </div>
  </div>
</div>

[← Datadog](datadog.md) | [← Monitoring Overview](index.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Dynatrace SaaS / Managed                               │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐ │
│  │ Davis AI │  │ Smartscape │  │  Grail (data lakehouse│ │
│  │ (causal) │  │ (topology) │  │  DQL query engine)   │ │
│  └──────────┘  └────────────┘  └──────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WebSocket
         ┌───────────────┴───────────────────┐
         │  ActiveGate (optional proxy)       │
         └────┬────────────────┬─────────────┘
              │                │
   ┌──────────▼──────┐   ┌─────▼───────────────────┐
   │  OneAgent       │   │  OTel Collector / Metric │
   │  (host process) │   │  Ingest API              │
   │  auto-injects   │   │  (OTLP endpoint)         │
   │  into every     │   └─────────────────────────┘
   │  process        │
   └─────────────────┘
```

---

## OneAgent — Kubernetes Deployment

```bash
# Operator-based deployment (recommended)
kubectl create namespace dynatrace

helm repo add dynatrace https://raw.githubusercontent.com/Dynatrace/dynatrace-operator/main/config/helm/repos/stable
helm repo update

helm upgrade --install dynatrace-operator dynatrace/dynatrace-operator \
  --namespace dynatrace \
  --atomic
```

```yaml
# dynakube.yaml — tells the Operator what to deploy
apiVersion: dynatrace.com/v1beta1
kind: DynaKube
metadata:
  name: dynakube
  namespace: dynatrace
spec:
  apiUrl: https://ENVIRONMENT_ID.live.dynatrace.com/api

  # Use existing secret: kubectl create secret generic dynakube \
  #   --from-literal=apiToken=$DT_API_TOKEN \
  #   --from-literal=dataIngestToken=$DT_INGEST_TOKEN
  tokens: dynakube

  metadataEnrichment:
    enabled: true       # inject Kubernetes metadata into all signals

  oneAgent:
    cloudNativeFullStack:
      # Auto-inject into application pods (no restart needed)
      tolerations:
        - operator: Exists
      env:
        - name: ONEAGENT_ENABLE_VOLUME_STORAGE
          value: "true"

  activeGate:
    capabilities:
      - routing
      - kubernetes-monitoring
      - metrics-ingest
      - dynatrace-api
    replicas: 2
    resources:
      requests:
        cpu: 500m
        memory: 512Mi
      limits:
        cpu: "1"
        memory: 1Gi
```

---

## OpenTelemetry Integration

Dynatrace natively ingests OTLP — send traces, metrics, and logs without OneAgent.

```yaml
# OTel Collector → Dynatrace OTLP endpoint
exporters:
  otlphttp/dynatrace:
    endpoint: "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/otlp"
    headers:
      Authorization: "Api-Token ${DT_API_TOKEN}"
    tls:
      insecure: false

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    send_batch_size: 1000
    timeout: 10s
  resourcedetection:
    detectors: [env, k8snode]

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/dynatrace]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/dynatrace]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/dynatrace]
```

```python
# Python — OTLP to Dynatrace
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

exporter = OTLPSpanExporter(
    endpoint="https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/otlp/v1/traces",
    headers={"Authorization": f"Api-Token {DT_API_TOKEN}"},
)
provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(exporter))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("my-service", "1.2.3")

with tracer.start_as_current_span("my_operation") as span:
    span.set_attribute("user.id", user_id)
    span.set_attribute("db.system", "postgresql")
    result = do_work()
```

---

## Metrics Ingest API

```bash
# Push custom metrics via Metrics Ingest API v2 (DynatraceQL line protocol)
curl -X POST "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/metrics/ingest" \
  -H "Authorization: Api-Token $DT_API_TOKEN" \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary "
custom.api.response_time,service=my-api,env=production 245
custom.api.request_count,service=my-api,env=production 1023
custom.api.error_count,service=my-api,env=production 5
"

# Push with gauge (explicit timestamp in ms)
curl -X POST "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/metrics/ingest" \
  -H "Authorization: Api-Token $DT_API_TOKEN" \
  -H "Content-Type: text/plain" \
  --data "custom.queue.depth,queue=orders gauge,$(date +%s%3N) 42"
```

---

## DQL — Dynatrace Query Language

Grail is Dynatrace's data lakehouse; DQL is its unified query language for metrics, logs, traces, events and topology.

```sql
-- P99 latency over the last hour by service
fetch dt.entity.service
| filter in(entity.name, "my-api", "auth-service")
| lookup [
    fetch metrics
    | filter metric.key == "builtin:service.response.time"
    | summarize p99 = percentile(value, 99), by: {dt.entity.service}
  ], sourceField: id, lookupField: dt.entity.service
| fields entity.name, p99

-- Log query — errors in the last 15 minutes
fetch logs, from: now() - 15m
| filter loglevel == "ERROR" and k8s.namespace.name == "production"
| summarize count = count(), by: {k8s.deployment.name, content}
| sort count desc
| limit 20

-- Trace query — slow spans
fetch spans, from: now() - 1h
| filter duration > 1000000000  -- nanoseconds → 1s
| fields span.name, service.name, duration, trace_id
| sort duration desc
| limit 50
```

---

## SLOs (Terraform)

```hcl
resource "dynatrace_slo_v2" "api_availability" {
  name        = "My API — Availability SLO"
  enabled     = true
  description = "99.9% of requests return non-5xx responses"

  metric_expression = "100 * (builtin:service.requestCount.server:filter(and(eq(dt.entity.service,SERVICE-XXXX),ne(http.response.code,5*))):splitBy():sum / builtin:service.requestCount.server:filter(eq(dt.entity.service,SERVICE-XXXX)):splitBy():sum)"

  target    = 99.9
  warning   = 99.95
  timeframe = "-30d"

  evaluation_type   = "AGGREGATE"
  evaluation_window = "-30d"
}
```

---

## Alerting & Problems

### Anomaly Detection (Terraform)

```hcl
resource "dynatrace_metric_events" "high_error_rate" {
  enabled     = true
  event_entity_dimension_key = "dt.entity.service"
  event_template {
    title       = "High Error Rate — {dt.entity.service}"
    description = "Error rate exceeded threshold on {dt.entity.service} in {dt.entity.process_group_instance}"
    event_type  = "PERFORMANCE"
    metadata {
      metadata_key   = "team"
      metadata_value = "backend"
    }
  }
  model_properties {
    type = "STATIC_THRESHOLD"
    alert_condition        = "ABOVE"
    alert_on_no_data       = false
    dealerting_samples     = 5
    samples                = 5
    threshold              = 5.0
    violating_samples      = 3
  }
  query_definition {
    type        = "METRIC_SELECTOR"
    aggregation = "AVG"
    metric_selector = "builtin:service.errors.total.rate:filter(eq(dt.entity.service,SERVICE-XXXX)):splitBy()"
  }
}
```

### Notification Integration

```hcl
# PagerDuty integration
resource "dynatrace_pagerduty_notification" "prod_alerts" {
  name    = "Production PagerDuty"
  active  = true
  profile = dynatrace_alerting_profile.prod.id

  account    = "my-pagerduty-account"
  service_api_key_secret = "pagerduty-service-key"
}

# Slack integration
resource "dynatrace_slack_notification" "sre_channel" {
  name    = "SRE Slack"
  active  = true
  profile = dynatrace_alerting_profile.prod.id
  url     = "https://hooks.slack.com/services/xxx/yyy/zzz"
  channel = "#sre-alerts"
  message = "**{ProblemTitle}** on {ImpactedEntities}\nSeverity: {ProblemSeverity}\n{ProblemURL}"
}
```

---

## Davis AI — Root Cause Analysis

Davis AI automatically correlates events and identifies the root cause within seconds of a problem opening. Key capabilities:

| Feature | Description |
|---------|-------------|
| **Automatic baselining** | Learns normal behaviour per entity, time-of-day, day-of-week |
| **Causal AI** | Links symptoms → root cause across topology hops |
| **Problem grouping** | Merges related alerts into one Problem card |
| **Impact analysis** | Shows which services/users are affected |
| **Auto-close** | Closes Problems when metrics return to baseline |

```bash
# Query Problems via API
curl "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/problems?problemSelector=status(OPEN)&pageSize=10" \
  -H "Authorization: Api-Token $DT_API_TOKEN" | \
  jq '.problems[] | {id, title, severity, impactLevel, affectedEntities: [.affectedEntities[].name]}'
```

---

## API Automation

```bash
# List all monitored services
curl "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/entities?entitySelector=type(SERVICE)&fields=displayName,properties" \
  -H "Authorization: Api-Token $DT_API_TOKEN" | jq '.entities[] | .displayName'

# Push deployment event (mark release in Dynatrace)
curl -X POST "https://ENVIRONMENT_ID.live.dynatrace.com/api/v2/events/ingest" \
  -H "Authorization: Api-Token $DT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "CUSTOM_DEPLOYMENT",
    "title": "Deploy my-api v1.2.3",
    "entitySelector": "type(SERVICE),entityName(my-api),tag(env:production)",
    "properties": {
      "version": "1.2.3",
      "git_sha": "'"$GIT_SHA"'",
      "deployed_by": "github-actions"
    }
  }'
```

[← Datadog](datadog.md) | [← Monitoring Overview](index.md)
