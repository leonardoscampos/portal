---
title: GitOps
description: Flux v2, ArgoCD, SOPS, Sealed Secrets, External Secrets and multi-cluster GitOps reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / gitops</span>
    <h1 class="dph-title">GitOps</h1>
    <p class="dph-desc">Git as the single source of truth for cluster state. A GitOps controller continuously reconciles the live cluster against the desired state in Git — eliminating configuration drift and enabling fully auditable, rollback-friendly deployments.</p>
    <div class="dph-badges">
      <span class="tech-badge">Flux v2</span>
      <span class="tech-badge">ArgoCD</span>
      <span class="tech-badge">SOPS</span>
      <span class="tech-badge">Sealed Secrets</span>
      <span class="tech-badge">External Secrets</span>
      <span class="tech-badge">Kustomize</span>
    </div>
  </div>
</div>

[← Helm](helm.md) | [← IaC Overview](index.md)

---

## GitOps Principles

| Principle | Description |
|-----------|-------------|
| **Declarative** | Desired state expressed in Git, not imperative scripts |
| **Versioned & immutable** | All changes are Git commits — auditable and revertable |
| **Continuously reconciled** | Controller detects and corrects drift automatically |
| **Pull-based** | Cluster pulls from Git; no CI push credentials in the cluster |

---

## Flux v2

Flux v2 is a set of Kubernetes controllers built on the GitOps Toolkit. Each controller manages a specific CRD.

| CRD | Purpose |
|-----|---------|
| `GitRepository` | Source: polls a Git repo for changes |
| `OCIRepository` | Source: polls an OCI artifact registry |
| `HelmRepository` | Source: polls a Helm chart index |
| `Kustomization` | Applies a Kustomize overlay from a source |
| `HelmRelease` | Installs/upgrades a Helm chart from a source |
| `ImageRepository` | Watches a container registry for new tags |
| `ImagePolicy` | Selects the latest image tag matching a policy |
| `ImageUpdateAutomation` | Commits new image tags back to Git |

### Bootstrap Flux onto a cluster

```bash
flux bootstrap github \
  --owner=my-org \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/prod \
  --personal
```

### GitRepository source

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: fleet-infra
  namespace: flux-system
spec:
  interval: 1m
  url: https://github.com/my-org/fleet-infra
  ref:
    branch: main
  secretRef:
    name: flux-system  # SSH deploy key secret
```

### Kustomization

```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: apps
  namespace: flux-system
spec:
  interval: 10m
  retryInterval: 1m
  timeout: 5m
  sourceRef:
    kind: GitRepository
    name: fleet-infra
  path: ./apps/production
  prune: true          # delete resources removed from Git
  wait: true
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: my-app
      namespace: production
```

### HelmRelease

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: my-app
  namespace: production
spec:
  interval: 15m
  chart:
    spec:
      chart: my-app
      version: ">=1.4.0 <2.0.0"
      sourceRef:
        kind: HelmRepository
        name: my-charts
        namespace: flux-system
  values:
    replicaCount: 3
    image:
      tag: "2.3.1"
  valuesFrom:
    - kind: ConfigMap
      name: my-app-values
  upgrade:
    remediation:
      retries: 3
  rollback:
    timeout: 5m
    cleanupOnFail: true
```

### Image Automation

```yaml
# Watch registry for new tags
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: my-app
  namespace: flux-system
spec:
  image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app
  interval: 5m
---
# Select latest semver tag
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: my-app
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: my-app
  policy:
    semver:
      range: ">=2.0.0 <3.0.0"
---
# Commit selected tag back to Git
apiVersion: image.toolkit.fluxcd.io/v1beta1
kind: ImageUpdateAutomation
metadata:
  name: flux-system
  namespace: flux-system
spec:
  interval: 30m
  sourceRef:
    kind: GitRepository
    name: fleet-infra
  git:
    push:
      branch: main
    commit:
      author:
        name: fluxbot
        email: fluxbot@example.com
```

---

## ArgoCD

ArgoCD is a declarative GitOps controller with a rich UI and RBAC model.

### Application

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: production

  source:
    repoURL: https://github.com/my-org/fleet-infra
    targetRevision: main
    path: apps/my-app/overlays/production

  destination:
    server: https://kubernetes.default.svc
    namespace: production

  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - PrunePropagationPolicy=foreground
    retry:
      limit: 3
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### ApplicationSet — one app per cluster

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: my-app
  namespace: argocd
spec:
  generators:
    - list:
        elements:
          - cluster: prod-us
            url: https://prod-us.k8s.example.com
            env: prod
          - cluster: prod-eu
            url: https://prod-eu.k8s.example.com
            env: prod
          - cluster: staging
            url: https://staging.k8s.example.com
            env: staging

  template:
    metadata:
      name: "my-app-{{cluster}}"
    spec:
      project: "{{env}}"
      source:
        repoURL: https://github.com/my-org/fleet-infra
        targetRevision: main
        path: "apps/my-app/overlays/{{env}}"
      destination:
        server: "{{url}}"
        namespace: my-app
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

### Flux vs ArgoCD

| Dimension | Flux v2 | ArgoCD |
|-----------|---------|--------|
| **Architecture** | Loosely-coupled controllers per CRD | Single monolithic server + repo-server |
| **UI** | Minimal (Weave GitOps OSS) | Full-featured web UI |
| **Multi-tenancy** | Flux tenants via namespaced CRDs | Projects + RBAC |
| **Image automation** | Built-in via ImagePolicy CRDs | Argocd-image-updater (separate project) |
| **Notification** | notification-controller | argocd-notifications |
| **Helm support** | HelmRelease CRD | Native, full lifecycle |
| **Kustomize** | Kustomization CRD | Native overlay support |
| **Multi-cluster** | One Flux per cluster | Centralized hub + agent spoke |

---

## Secrets in GitOps

### SOPS — Encrypt secrets in Git

SOPS encrypts only the values in YAML/JSON files, leaving keys readable.

```bash
# Generate a age key pair
age-keygen -o age.agekey
cat age.agekey | grep public   # store public key

# Encrypt a secret file with age
sops --encrypt \
  --age age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  secrets.yaml > secrets.enc.yaml

# Decrypt locally
sops --decrypt secrets.enc.yaml
```

```yaml
# .sops.yaml — automatic encryption rules
creation_rules:
  - path_regex: .*/secrets\.yaml$
    age: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Flux integrates SOPS natively — store the age private key as a K8s secret:

```bash
cat age.agekey | kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey=/dev/stdin
```

```yaml
# Kustomization with SOPS decryption
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: secrets
  namespace: flux-system
spec:
  interval: 10m
  sourceRef:
    kind: GitRepository
    name: fleet-infra
  path: ./secrets/production
  prune: true
  decryption:
    provider: sops
    secretRef:
      name: sops-age
```

---

### External Secrets Operator

ESO syncs secrets from external stores (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, HashiCorp Vault) into Kubernetes Secrets.

```yaml
# SecretStore — connection to the external system
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
---
# ExternalSecret — create a K8s Secret from a remote secret
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager
  target:
    name: db-credentials       # name of the K8s Secret to create
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: prod/my-app/db
        property: password
    - secretKey: DB_HOST
      remoteRef:
        key: prod/my-app/db
        property: host
```

---

## Multi-Cluster Repository Layout

```
fleet-infra/
├── clusters/
│   ├── prod-us/
│   │   ├── flux-system/         # bootstrapped by flux bootstrap
│   │   └── apps.yaml            # Kustomization pointing to apps/prod
│   ├── prod-eu/
│   │   ├── flux-system/
│   │   └── apps.yaml
│   └── staging/
│       ├── flux-system/
│       └── apps.yaml
├── apps/
│   ├── base/                    # shared Kustomize base
│   │   ├── my-app/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── kustomization.yaml
│   └── overlays/
│       ├── prod/
│       │   └── kustomization.yaml   # patches replicas, resources, image
│       └── staging/
│           └── kustomization.yaml
└── infrastructure/
    ├── base/                    # cert-manager, ingress-nginx, ESO
    └── overlays/
        ├── prod/
        └── staging/
```
