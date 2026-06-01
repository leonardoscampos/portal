---
title: OpenTelemetry
description: Instrumentação vendor-neutral com OpenTelemetry SDK, pipelines do Coletor, traces, métricas e logs.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / opentelemetry</span>
    <h1 class="dph-title">OpenTelemetry</h1>
    <p class="dph-desc">OpenTelemetry (OTel) é o padrão CNCF para instrumentação de observabilidade. Um único SDK produz traces, métricas e logs — o Coletor os recebe, processa e exporta para qualquer backend. Instrumente uma vez, troque de backend sem alterações no código.</p>
    <div class="dph-badges">
      <span class="tech-badge">OTel SDK</span>
      <span class="tech-badge">Collector</span>
      <span class="tech-badge">Traces</span>
      <span class="tech-badge">Metrics</span>
      <span class="tech-badge">Logs</span>
      <span class="tech-badge">OTLP</span>
    </div>
  </div>
</div>

[← Loki](loki.md) | [← Visão Geral de Monitoramento](index.md) | [Alerting →](alerting.md)

---

## Visão Geral dos Sinais

| Sinal | Descrição | API OTel Principal | Backends |
|--------|-------------|--------------|---------|
| **Traces** | Fluxo de requisição entre serviços | `Tracer`, `Span` | Tempo, Jaeger, Zipkin, Datadog |
| **Métricas** | Medições agregadas ao longo do tempo | `Meter`, `Counter`, `Histogram` | Prometheus, Mimir, Datadog |
| **Logs** | Eventos estruturados com carimbo de tempo | `Logger` (LogRecord) | Loki, Elasticsearch, Cloud Logging |

---

## Arquitetura do Coletor

```
 [App SDK]──OTLP──▶[Collector]──▶[Backend]
                      │
              ┌───────┼────────┐
         Receivers  Processors  Exporters
           OTLP      Batch       Prometheus
           Jaeger    Filter      OTLP/gRPC
           Prometheus Memory-    OTLP/HTTP
           Filelog   Limiter     Loki
           Zipkin    Attributes  Jaeger
                     Tail Sample
```

---

## Deploy do Coletor (Helm)

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

# Gateway collector (Deployment — receives from apps)
helm upgrade --install otel-collector open-telemetry/opentelemetry-collector \
  --namespace monitoring \
  --values otel-collector-values.yaml

# Agent collector (DaemonSet — runs on every node)
helm upgrade --install otel-agent open-telemetry/opentelemetry-collector \
  --namespace monitoring \
  --set mode=daemonset \
  --values otel-agent-values.yaml
```

```yaml
# otel-collector-values.yaml (gateway / Deployment mode)
mode: deployment
replicaCount: 2

config:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317
        http:
          endpoint: 0.0.0.0:4318
    prometheus:
      config:
        scrape_configs:
          - job_name: otel-collector
            static_configs:
              - targets: ["${env:MY_POD_IP}:8888"]

  processors:
    memory_limiter:
      check_interval: 5s
      limit_percentage: 80
      spike_limit_percentage: 25
    batch:
      send_batch_size: 8192
      timeout: 200ms
      send_batch_max_size: 16384
    resource:
      attributes:
        - key: deployment.environment
          value: production
          action: upsert
        - key: k8s.cluster.name
          value: prod-cluster
          action: upsert
    tail_sampling:
      decision_wait: 10s
      num_traces: 100000
      expected_new_traces_per_sec: 1000
      policies:
        - name: errors-policy
          type: status_code
          status_code: { status_codes: [ERROR] }
        - name: slow-policy
          type: latency
          latency: { threshold_ms: 500 }
        - name: probabilistic-policy
          type: probabilistic
          probabilistic: { sampling_percentage: 5 }

  exporters:
    otlphttp/tempo:
      endpoint: http://tempo.monitoring.svc:4318
    prometheusremotewrite:
      endpoint: http://kube-prometheus-stack-prometheus.monitoring.svc:9090/api/v1/write
    loki:
      endpoint: http://loki.monitoring.svc:3100/loki/api/v1/push
      default_labels_enabled:
        exporter: false
        level: true

  service:
    pipelines:
      traces:
        receivers:  [otlp]
        processors: [memory_limiter, batch, resource, tail_sampling]
        exporters:  [otlphttp/tempo]
      metrics:
        receivers:  [otlp, prometheus]
        processors: [memory_limiter, batch, resource]
        exporters:  [prometheusremotewrite]
      logs:
        receivers:  [otlp]
        processors: [memory_limiter, batch, resource]
        exporters:  [loki]
```

---

## Instrumentação do SDK

=== "Go"

    ```go
    package main

    import (
        "context"
        "go.opentelemetry.io/otel"
        "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
        "go.opentelemetry.io/otel/sdk/resource"
        sdktrace "go.opentelemetry.io/otel/sdk/trace"
        semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
    )

    func initTracer(ctx context.Context) (*sdktrace.TracerProvider, error) {
        exporter, err := otlptracegrpc.New(ctx,
            otlptracegrpc.WithEndpoint("otel-collector.monitoring.svc:4317"),
            otlptracegrpc.WithInsecure(),
        )
        if err != nil {
            return nil, err
        }

        tp := sdktrace.NewTracerProvider(
            sdktrace.WithBatcher(exporter),
            sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))),
            sdktrace.WithResource(resource.NewWithAttributes(
                semconv.SchemaURL,
                semconv.ServiceName("my-service"),
                semconv.ServiceVersion("1.0.0"),
                semconv.DeploymentEnvironment("production"),
            )),
        )
        otel.SetTracerProvider(tp)
        return tp, nil
    }

    // Instrument an operation
    func handleRequest(ctx context.Context) {
        tracer := otel.Tracer("my-service")
        ctx, span := tracer.Start(ctx, "handleRequest")
        defer span.End()

        span.SetAttributes(
            attribute.String("user.id", "u123"),
            attribute.Int("items.count", 5),
        )

        // child span
        _, child := tracer.Start(ctx, "db.query")
        defer child.End()
        // ... database call ...
    }
    ```

=== "Python"

    ```python
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME

    # Initialize
    resource = Resource.create({SERVICE_NAME: "my-service"})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint="otel-collector.monitoring.svc:4317", insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    tracer = trace.get_tracer("my-service")

    # Instrument
    with tracer.start_as_current_span("process-request") as span:
        span.set_attribute("user.id", "u123")
        span.set_attribute("request.size", 1024)
        # ... business logic ...
    ```

=== "Java"

    ```java
    // Add dependency: opentelemetry-sdk, opentelemetry-exporter-otlp
    // Or use the Java agent for zero-code instrumentation:

    // Dockerfile
    // COPY opentelemetry-javaagent.jar /app/
    // CMD ["java", "-javaagent:/app/opentelemetry-javaagent.jar", \
    //      "-Dotel.exporter.otlp.endpoint=http://otel-collector.monitoring.svc:4317", \
    //      "-Dotel.service.name=my-service", \
    //      "-jar", "/app/app.jar"]

    // Manual instrumentation:
    OpenTelemetry openTelemetry = OpenTelemetrySdk.builder()
        .setTracerProvider(SdkTracerProvider.builder()
            .addSpanProcessor(BatchSpanProcessor.builder(
                OtlpGrpcSpanExporter.builder()
                    .setEndpoint("http://otel-collector.monitoring.svc:4317")
                    .build())
                .build())
            .build())
        .build();

    Tracer tracer = openTelemetry.getTracer("my-service");
    Span span = tracer.spanBuilder("processOrder").startSpan();
    try (Scope scope = span.makeCurrent()) {
        span.setAttribute("order.id", orderId);
        // ... business logic ...
    } catch (Exception e) {
        span.recordException(e);
        span.setStatus(StatusCode.ERROR);
        throw e;
    } finally {
        span.end();
    }
    ```

=== "Node.js"

    ```typescript
    import { NodeSDK } from '@opentelemetry/sdk-node';
    import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
    import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
    import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
    import { Resource } from '@opentelemetry/resources';
    import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
    import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: 'my-service',
      }),
      traceExporter: new OTLPTraceExporter({
        url: 'http://otel-collector.monitoring.svc:4317',
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: 'http://otel-collector.monitoring.svc:4317',
        }),
        exportIntervalMillis: 15000,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
    process.on('SIGTERM', () => sdk.shutdown());
    ```

---

## Métricas com o SDK OTel

```go
// Go — create and record metrics
meter := otel.Meter("my-service")

// Counter
requestCounter, _ := meter.Int64Counter("http.requests.total",
    metric.WithDescription("Total HTTP requests"),
)

// Histogram
latencyHistogram, _ := meter.Float64Histogram("http.request.duration",
    metric.WithDescription("HTTP request latency"),
    metric.WithUnit("s"),
    metric.WithExplicitBucketBoundaries(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

// Gauge (UpDownCounter)
activeConns, _ := meter.Int64UpDownCounter("http.connections.active")

// Record
requestCounter.Add(ctx, 1,
    metric.WithAttributes(
        attribute.String("method", r.Method),
        attribute.Int("status", statusCode),
    ),
)
latencyHistogram.Record(ctx, elapsed.Seconds(),
    metric.WithAttributes(attribute.String("route", r.URL.Path)),
)
```

---

## Kubernetes Operator — CRD do Coletor OTel

```bash
# Install OpenTelemetry Operator
helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace monitoring \
  --set admissionWebhooks.certManager.enabled=true
```

```yaml
# OpenTelemetryCollector CR — managed by the Operator
apiVersion: opentelemetry.io/v1alpha1
kind: OpenTelemetryCollector
metadata:
  name: prod-collector
  namespace: monitoring
spec:
  mode: deployment           # deployment | daemonset | statefulset | sidecar
  replicas: 2
  config: |
    receivers:
      otlp:
        protocols:
          grpc: {}
          http: {}
    processors:
      batch: {}
      memory_limiter:
        limit_mib: 400
        spike_limit_mib: 80
    exporters:
      otlphttp/tempo:
        endpoint: http://tempo.monitoring.svc:4318
      prometheusremotewrite:
        endpoint: http://prometheus.monitoring.svc:9090/api/v1/write
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [otlphttp/tempo]
        metrics:
          receivers: [otlp]
          processors: [memory_limiter, batch]
          exporters: [prometheusremotewrite]
```

```yaml
# Instrumentation CR — auto-inject SDK into pods
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: my-instrumentation
  namespace: production
spec:
  exporter:
    endpoint: http://prod-collector.monitoring.svc:4317
  propagators: [tracecontext, baggage, b3]
  sampler:
    type: parentbased_traceidratio
    argument: "0.1"
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
  python:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-python:latest
  nodejs:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-nodejs:latest
  go:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-go:latest
```

```yaml
# Pod annotation — triggers auto-injection
metadata:
  annotations:
    instrumentation.opentelemetry.io/inject-java: "true"
    # or: inject-python, inject-nodejs, inject-go
```

---

## Propagação de Contexto

```
Service A ──────────────────────────────▶ Service B
  │  HTTP header:                           │
  │  traceparent: 00-{traceId}-{spanId}-01  │
  │  tracestate: ...                        │
  ▼                                         ▼
Span A (root)                           Span B (child)
  traceId: abc123                         traceId: abc123
  spanId: 111                             spanId: 222
  parentSpanId: (none)                    parentSpanId: 111
```

### Formatos de Propagação

| Formato | Header | Caso de Uso |
|--------|--------|---------|
| W3C TraceContext | `traceparent`, `tracestate` | Padrão para OTel |
| B3 (single) | `b3` | Zipkin, Istio |
| B3 (multi) | `X-B3-TraceId`, `X-B3-SpanId` | Legado |
| Baggage | `baggage` | Propagação de chave-valor entre serviços |

---

## Convenções Semânticas (Atributos Principais)

| Namespace | Atributos Principais |
|-----------|---------------|
| HTTP | `http.request.method`, `http.response.status_code`, `url.path`, `server.address` |
| DB | `db.system`, `db.name`, `db.operation.name`, `db.query.text` |
| Messaging | `messaging.system`, `messaging.destination.name`, `messaging.operation` |
| RPC | `rpc.system`, `rpc.service`, `rpc.method` |
| Cloud | `cloud.provider`, `cloud.region`, `cloud.account.id` |
| K8s | `k8s.cluster.name`, `k8s.namespace.name`, `k8s.pod.name`, `k8s.container.name` |

[← Loki](loki.md) | [← Visão Geral de Monitoramento](index.md) | [Alerting →](alerting.md)
