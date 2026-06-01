---
title: APM & Distributed Tracing
description: Jaeger, Grafana Tempo, Elastic APM, Datadog, and New Relic for distributed tracing and application performance monitoring.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / apm</span>
    <h1 class="dph-title">APM & Distributed Tracing</h1>
    <p class="dph-desc">Distributed tracing follows a request as it propagates across microservices, revealing latency bottlenecks and error sources invisible to metrics alone. APM platforms layer on auto-instrumentation, profiling, and dependency maps to accelerate root-cause analysis.</p>
    <div class="dph-badges">
      <span class="tech-badge">Jaeger</span>
      <span class="tech-badge">Tempo</span>
      <span class="tech-badge">Elastic APM</span>
      <span class="tech-badge">Datadog</span>
      <span class="tech-badge">New Relic</span>
      <span class="tech-badge">Continuous Profiling</span>
    </div>
  </div>
</div>

[← Alerting](alerting.md) | [← Monitoring Overview](index.md)

---

## Tool Comparison

| Tool | Type | Storage | Cost model | OTel native |
|------|------|---------|-----------|-------------|
| **Grafana Tempo** | OSS tracing backend | Object store (S3/GCS) | Storage cost only | Yes (OTLP) |
| **Jaeger** | OSS tracing backend | Cassandra / Elasticsearch / memory | Storage cost only | Yes (via OTEL) |
| **Elastic APM** | APM platform | Elasticsearch | Self-host or Elastic Cloud | Via OTel |
| **Datadog APM** | SaaS APM + infra | Managed (SaaS) | Per host/span | Yes (OTLP ingestion) |
| **New Relic** | SaaS APM + infra | Managed (SaaS) | Per data GB | Yes |
| **Pyroscope** | Continuous profiling | Object store | Open source | Via OTel profiling |

---

## Grafana Tempo

### Installation (Helm)

```bash
helm upgrade --install tempo grafana/tempo-distributed \
  --namespace monitoring \
  --values tempo-values.yaml
```

```yaml
# tempo-values.yaml — distributed mode with S3 backend
storage:
  trace:
    backend: s3
    s3:
      bucket: my-tempo-traces
      endpoint: s3.us-east-1.amazonaws.com
      region: us-east-1

ingester:
  replicas: 3
  resources:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { memory: 2Gi }

distributor:
  replicas: 2

compactor:
  replicas: 1

querier:
  replicas: 2

queryFrontend:
  replicas: 2

# Receive OTLP, Jaeger, Zipkin
traces:
  otlp:
    grpc:
      enabled: true
    http:
      enabled: true
  jaeger:
    thriftCompact:
      enabled: true
    grpcPlugin:
      enabled: true

# TraceQL metrics (requires search enabled)
metricsGenerator:
  enabled: true
  replicas: 1
  config:
    registry:
      external_labels:
        source: tempo
        cluster: prod-cluster
    storage:
      remote_write:
        - url: http://kube-prometheus-stack-prometheus.monitoring.svc:9090/api/v1/write
    processor:
      service_graphs:
        enabled: true
        max_items: 10000
      span_metrics:
        enabled: true
        dimensions: [service.name, span.name, span.kind, status.code]
```

### TraceQL

```
# Find all failing traces for a service
{ .service.name = "api" && status = error }

# Slow requests
{ .service.name = "api" && duration > 500ms }

# Traces with a specific HTTP route
{ span.http.target = "/api/orders" && duration > 1s }

# Multi-service traces touching the database
{ .service.name = "api" } >> { span.db.system = "postgresql" }

# Error in any span within a trace
{ rootName = "POST /checkout" && traceDuration > 2s }

# Aggregate: P99 latency by service
{ status != error } | rate() by (.service.name)
```

---

## Jaeger

### Installation (Operator)

```bash
kubectl create namespace observability
kubectl apply -f https://github.com/jaegertracing/jaeger-operator/releases/latest/download/jaeger-operator.yaml \
  -n observability
```

```yaml
# Jaeger CR — production mode with Elasticsearch backend
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: prod-jaeger
  namespace: observability
spec:
  strategy: production

  collector:
    replicas: 2
    resources:
      limits: { memory: 1Gi }

  query:
    replicas: 2
    options:
      log-level: info
    resources:
      limits: { memory: 512Mi }

  storage:
    type: elasticsearch
    options:
      es:
        server-urls: https://elasticsearch.logging.svc:9200
        index-prefix: jaeger
        tls:
          enabled: true
          ca: /es/certificates/ca.crt
    secretName: jaeger-es-secret

  ingress:
    enabled: true
    ingressClassName: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
      - tracing.internal

  # Sampling — remote controlled
  sampling:
    options:
      default_strategy:
        type: probabilistic
        param: 0.1
      service_strategies:
        - service: critical-payment-service
          type: probabilistic
          param: 1.0    # 100% sampling for payment service
```

---

## Elastic APM

### Stack Helm Install

```bash
# Elasticsearch + Kibana + APM Server via ECK (Elastic Cloud on Kubernetes)
kubectl apply -f https://download.elastic.co/downloads/eck/2.12.1/crds.yaml
kubectl apply -f https://download.elastic.co/downloads/eck/2.12.1/operator.yaml
```

```yaml
# Elasticsearch cluster
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: prod
  namespace: elastic
spec:
  version: 8.14.0
  nodeSets:
    - name: default
      count: 3
      config:
        node.store.allow_mmap: false
      volumeClaimTemplates:
        - metadata: { name: elasticsearch-data }
          spec:
            storageClassName: gp3
            resources:
              requests:
                storage: 100Gi
---
# APM Server
apiVersion: apm.k8s.elastic.co/v1
kind: ApmServer
metadata:
  name: prod
  namespace: elastic
spec:
  version: 8.14.0
  count: 2
  elasticsearchRef:
    name: prod
  config:
    apm-server:
      rum:
        enabled: true      # Real User Monitoring (browser)
        allow_origins: ["https://app.example.com"]
```

### APM Agent (Python / Node)

=== "Python"

    ```python
    # pip install elastic-apm
    from elasticapm.contrib.flask import ElasticAPM

    app = Flask(__name__)
    app.config['ELASTIC_APM'] = {
        'SERVICE_NAME': 'my-flask-app',
        'SECRET_TOKEN': os.environ['ELASTIC_APM_SECRET_TOKEN'],
        'SERVER_URL': 'http://apm-server.elastic.svc:8200',
        'ENVIRONMENT': 'production',
        'TRANSACTION_SAMPLE_RATE': 0.1,
    }
    apm = ElasticAPM(app)
    ```

=== "Node.js"

    ```javascript
    // npm install elastic-apm-node
    // Must be the first require in your app entry point
    const apm = require('elastic-apm-node').start({
      serviceName: 'my-node-app',
      secretToken: process.env.ELASTIC_APM_SECRET_TOKEN,
      serverUrl: 'http://apm-server.elastic.svc:8200',
      environment: 'production',
      transactionSampleRate: 0.1,
    });
    ```

=== "Java"

    ```bash
    # Java agent — zero code change
    java -javaagent:/path/to/elastic-apm-agent.jar \
      -Delastic.apm.service_name=my-java-app \
      -Delastic.apm.server_url=http://apm-server.elastic.svc:8200 \
      -Delastic.apm.environment=production \
      -Delastic.apm.transaction_sample_rate=0.1 \
      -jar app.jar
    ```

---

## Datadog APM

### Kubernetes Deployment (Operator)

```bash
helm repo add datadog https://helm.datadoghq.com
helm upgrade --install datadog-operator datadog/datadog-operator \
  --namespace datadog
```

```yaml
apiVersion: datadoghq.com/v2alpha1
kind: DatadogAgent
metadata:
  name: datadog
  namespace: datadog
spec:
  global:
    clusterName: prod-cluster
    credentials:
      apiSecret:
        secretName: datadog-secret
        keyName: api-key
      appSecret:
        secretName: datadog-secret
        keyName: app-key

  features:
    apm:
      enabled: true
      instrumentation:
        enabled: true          # auto-instrument pods with annotation
        libVersions:
          java:   "1"
          python: "2"
          js:     "5"
    logCollection:
      enabled: true
      containerCollectAll: true
    npm:
      enabled: true            # Network Performance Monitoring
    usm:
      enabled: true            # Universal Service Monitoring
    liveProcesses:
      enabled: true
    oomKill:
      enabled: true
```

```yaml
# Auto-instrument a pod
metadata:
  annotations:
    admission.datadoghq.com/python-lib.version: "v2"
    # or: java-lib.version, js-lib.version, dotnet-lib.version, ruby-lib.version
```

### Datadog Unified Service Tagging

```yaml
# Always add these labels to pods for service correlation
labels:
  tags.datadoghq.com/env:     production
  tags.datadoghq.com/service: my-api
  tags.datadoghq.com/version: "1.2.3"
```

---

## Continuous Profiling — Pyroscope

```bash
helm upgrade --install pyroscope grafana/pyroscope \
  --namespace monitoring \
  --set storage.backend=s3 \
  --set "storage.s3.bucket=my-pyroscope-profiles" \
  --set "storage.s3.region=us-east-1"
```

```go
// Go — push profiling data to Pyroscope
import "github.com/grafana/pyroscope-go"

pyroscope.Start(pyroscope.Config{
    ApplicationName: "my-service",
    ServerAddress:   "http://pyroscope.monitoring.svc:4040",
    ProfileTypes: []pyroscope.ProfileType{
        pyroscope.ProfileCPU,
        pyroscope.ProfileAllocObjects,
        pyroscope.ProfileAllocSpace,
        pyroscope.ProfileInuseObjects,
        pyroscope.ProfileInuseSpace,
        pyroscope.ProfileGoroutines,
    },
    Tags: map[string]string{
        "env": "production",
    },
})
```

```yaml
# Pyroscope — auto-instrumentation via annotations (when using Grafana Alloy)
metadata:
  annotations:
    profiles.grafana.com/cpu.scrape: "true"
    profiles.grafana.com/cpu.port: "6060"
    profiles.grafana.com/memory.scrape: "true"
```

---

## Observability Platform Decision Matrix

| Need | Recommended stack |
|------|------------------|
| OSS only, cost-sensitive | Prometheus + Grafana + Loki + Tempo + Alloy |
| Long-term metrics retention | Add Mimir or Thanos |
| Log-heavy workloads | Loki (cheap) or Elasticsearch (full-text search) |
| Distributed tracing only | Grafana Tempo (simple) or Jaeger |
| Full SaaS APM | Datadog or New Relic |
| Elastic stack already deployed | Elastic APM (reuse existing Elasticsearch) |
| Continuous profiling | Pyroscope (OSS) or Datadog Continuous Profiler |
| Multi-cloud/vendor-neutral | OpenTelemetry Collector + multiple exporters |

[← Alerting](alerting.md) | [← Monitoring Overview](index.md)
