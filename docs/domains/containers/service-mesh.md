---
title: Malha de Serviços
description: Malha de serviços Istio e Linkerd — mTLS, gerenciamento de tráfego, observabilidade, implantações canário e injeção de falhas.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / service-mesh</span>
    <h1 class="dph-title">Malha de Serviços</h1>
    <p class="dph-desc">Camada de infraestrutura transparente para comunicação serviço a serviço. mTLS automático, gerenciamento de tráfego granular, observabilidade L7 rica e padrões de entrega progressiva — tudo sem alterar o código da aplicação.</p>
    <div class="dph-badges">
      <span class="tech-badge">Istio</span>
      <span class="tech-badge">Linkerd</span>
      <span class="tech-badge">mTLS</span>
      <span class="tech-badge">Gerenciamento de Tráfego</span>
      <span class="tech-badge">Canário</span>
      <span class="tech-badge">Injeção de Falhas</span>
    </div>
  </div>
</div>

[← Kubernetes](kubernetes.md) | [← Visão Geral de Contêineres](index.md) | [Operadores →](operators.md)

---

## Istio vs Linkerd

| Recurso | Istio | Linkerd |
|---------|-------|---------|
| **Proxy** | Envoy (poderoso, pesado) | Linkerd2-proxy (Rust, ultraleve) |
| **Instalação** | Helm / `istioctl` | Helm / CLI `linkerd` |
| **mTLS** | Opcional por namespace/workload | Automático para todos os pods na malha |
| **Gerenciamento de tráfego** | VirtualService, DestinationRule | HTTPRoute (Gateway API) |
| **Observabilidade** | Jaeger, Prometheus, Kiali | Dashboard Viz, Prometheus |
| **Detecção de protocolo** | Automática | Automática |
| **Sobrecarga de recursos** | Alta (~50–100 MB/pod) | Baixa (~10–20 MB/pod) |
| **Curva de aprendizado** | Íngreme | Suave |
| **Multi-cluster** | Integrado (multi-primary, primary-remote) | Espelhamento de serviços |
| **Extensões WASM** | Sim (EnvoyFilter) | Não |

---

## Istio

### Instalação

```bash
# Install istioctl
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.22.1 sh -
export PATH="$PWD/istio-1.22.1/bin:$PATH"

# Install with the minimal profile
istioctl install --set profile=minimal -y

# Enable sidecar injection for a namespace
kubectl label namespace production istio-injection=enabled

# Verify
istioctl verify-install
istioctl analyze -n production
```

### VirtualService — Roteamento de Tráfego

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api
  namespace: production
spec:
  hosts:
    - api                        # K8s service name or FQDN
  http:
    # Canary: 10% to v2, 90% to v1
    - match:
        - headers:
            x-canary:
              exact: "true"      # header-based routing (devs / testers)
      route:
        - destination:
            host: api
            subset: v2
          weight: 100

    - route:
        - destination:
            host: api
            subset: v1
          weight: 90
        - destination:
            host: api
            subset: v2
          weight: 10

    # Retry policy
    retries:
      attempts: 3
      perTryTimeout: 5s
      retryOn: 5xx,reset,connect-failure

    # Timeout
    timeout: 30s
```

### DestinationRule — Balanceamento de Carga e Disjuntor

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: api
  namespace: production
spec:
  host: api
  trafficPolicy:
    loadBalancer:
      simple: LEAST_CONN
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        http2MaxRequests: 1000
        pendingHttpRequests: 100
    outlierDetection:             # circuit breaker
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
```

### Injeção de Falhas

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api-chaos
spec:
  hosts: [api]
  http:
    - fault:
        delay:
          percentage:
            value: 10            # 10% of requests get a 2s delay
          fixedDelay: 2s
        abort:
          percentage:
            value: 5             # 5% of requests return HTTP 503
          httpStatus: 503
      route:
        - destination:
            host: api
            subset: v1
```

### Política de mTLS

```yaml
# Enforce STRICT mTLS across the entire mesh
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system        # mesh-wide policy
spec:
  mtls:
    mode: STRICT

---
# Allow plaintext for a specific service (migration)
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: api-permissive
  namespace: production
spec:
  selector:
    matchLabels:
      app: legacy-api
  mtls:
    mode: PERMISSIVE
```

### AuthorizationPolicy

```yaml
# Deny all by default
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-all
  namespace: production
spec: {}

---
# Allow ingress-gateway → api on GET /api/*
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-ingress-to-api
  namespace: production
spec:
  selector:
    matchLabels:
      app: api
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - cluster.local/ns/istio-system/sa/istio-ingressgateway-service-account
      to:
        - operation:
            methods: [GET, POST]
            paths: ["/api/*"]
```

### Observabilidade com Kiali

```bash
# Install Kiali + addons
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.22/samples/addons/kiali.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.22/samples/addons/prometheus.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.22/samples/addons/grafana.yaml
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.22/samples/addons/jaeger.yaml

# Access Kiali dashboard
istioctl dashboard kiali
```

---

## Linkerd

### Instalação

```bash
# Install Linkerd CLI
curl --proto '=https' --tlsv1.2 -sSfL https://run.linkerd.io/install | sh
export PATH=$HOME/.linkerd2/bin:$PATH

# Pre-flight check
linkerd check --pre

# Install CRDs and control plane
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -

# Verify
linkerd check

# Install Viz extension (metrics dashboard)
linkerd viz install | kubectl apply -f -
linkerd viz check
linkerd viz dashboard &
```

### Inclusão de Workloads na Malha

```bash
# Inject sidecar via namespace annotation (auto-injection)
kubectl annotate namespace production linkerd.io/inject=enabled

# Or inject into an existing deployment
kubectl get deploy api -n production -o yaml | \
  linkerd inject - | \
  kubectl apply -f -

# Check mesh status
linkerd -n production check --proxy
linkerd viz stat deploy -n production
linkerd viz top deploy/api -n production
```

### HTTPRoute (Gateway API)

```yaml
# Traffic split for canary (Linkerd uses Gateway API HTTPRoute)
apiVersion: gateway.networking.k8s.io/v1beta1
kind: HTTPRoute
metadata:
  name: api-canary
  namespace: production
spec:
  parentRefs:
    - name: api
      kind: Service
      group: core
      port: 80
  rules:
    - backendRefs:
        - name: api-stable
          port: 80
          weight: 90
        - name: api-canary
          port: 80
          weight: 10
```

### ServiceProfile (Tentativas e Tempos Limite)

```yaml
apiVersion: linkerd.io/v1alpha2
kind: ServiceProfile
metadata:
  name: api.production.svc.cluster.local
  namespace: production
spec:
  routes:
    - name: GET /api/users
      condition:
        method: GET
        pathRegex: /api/users(/.*)?
      responseClasses:
        - condition:
            status:
              min: 500
              max: 599
          isFailure: true
      retryBudget:
        retryRatio: 0.2
        minRetriesPerSecond: 10
        ttl: 10s
      timeout: 5s
```

### Multi-cluster com Espelhamento de Serviços

```bash
# Link clusters
linkerd multicluster install | kubectl apply -f -
linkerd multicluster link --cluster-name=prod-us-east \
  --kubeconfig=$HOME/.kube/prod-us-east | kubectl apply -f -

# Export a service from the target cluster
kubectl label svc api mirror.linkerd.io/exported=true -n production

# The service appears in the source cluster as:
# api-prod-us-east.production.svc.cluster.local
```

---

## Fluxo de Entrega Canário

```
Initial state: 100% → stable (v1)

Step 1:  10% → canary (v2),  90% → stable (v1)
Step 2:  25% → canary (v2),  75% → stable (v1)   ← monitor error rate & p99 latency
Step 3:  50% → canary (v2),  50% → stable (v1)
Step 4: 100% → canary (v2),   0% → stable (v1)   ← promote: canary becomes stable
         OR rollback if SLO breach detected
```

Automatize isso com [Flagger](https://flagger.app):

```yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: api
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  service:
    port: 80
    targetPort: 8080
  analysis:
    interval: 1m
    threshold: 5                 # max failed analysis runs
    maxWeight: 50                # max canary traffic %
    stepWeight: 10               # increment per interval
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 1m
      - name: request-duration
        thresholdRange:
          max: 500               # p99 latency ms
        interval: 1m
    webhooks:
      - name: load-test
        url: http://flagger-loadtester.flagger/
        metadata:
          cmd: "hey -z 1m -q 10 -c 2 http://api.production/"
```

[← Kubernetes](kubernetes.md) | [← Visão Geral de Contêineres](index.md) | [Operadores →](operators.md)
