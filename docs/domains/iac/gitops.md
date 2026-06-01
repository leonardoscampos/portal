---
title: GitOps
description: Referência de Flux v2, ArgoCD, SOPS, Sealed Secrets, External Secrets e GitOps multi-cluster.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / gitops</span>
    <h1 class="dph-title">GitOps</h1>
    <p class="dph-desc">Git como única fonte de verdade para o estado do cluster. Um controlador GitOps reconcilia continuamente o cluster em execução com o estado desejado no Git — eliminando o desvio de configuração e possibilitando implantações totalmente auditáveis e com suporte a rollback.</p>
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

[← Helm](helm.md) | [← Visão Geral de IaC](index.md)

---

## Princípios do GitOps

| Princípio | Descrição |
|-----------|-------------|
| **Declarativo** | Estado desejado expresso no Git, não em scripts imperativos |
| **Versionado e imutável** | Todas as alterações são commits no Git — auditáveis e reversíveis |
| **Continuamente reconciliado** | O controlador detecta e corrige desvios automaticamente |
| **Baseado em pull** | O cluster puxa do Git; sem credenciais de push de CI no cluster |

---

## Flux v2

O Flux v2 é um conjunto de controladores Kubernetes construído sobre o GitOps Toolkit. Cada controlador gerencia um CRD específico.

| CRD | Finalidade |
|-----|---------|
| `GitRepository` | Fonte: monitora um repositório Git por mudanças |
| `OCIRepository` | Fonte: monitora um registry de artefatos OCI |
| `HelmRepository` | Fonte: monitora um índice de charts Helm |
| `Kustomization` | Aplica um overlay Kustomize de uma fonte |
| `HelmRelease` | Instala/atualiza um chart Helm de uma fonte |
| `ImageRepository` | Monitora um registry de contêineres por novas tags |
| `ImagePolicy` | Seleciona a tag de imagem mais recente que corresponde a uma política |
| `ImageUpdateAutomation` | Realiza commits de novas tags de imagem de volta ao Git |

### Bootstrap do Flux em um cluster

```bash
flux bootstrap github \
  --owner=my-org \
  --repository=fleet-infra \
  --branch=main \
  --path=clusters/prod \
  --personal
```

### Fonte GitRepository

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

### Automação de Imagem

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

ArgoCD é um controlador GitOps declarativo com uma interface rica e modelo RBAC.

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

### ApplicationSet — um app por cluster

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

| Dimensão | Flux v2 | ArgoCD |
|-----------|---------|--------|
| **Arquitetura** | Controladores fracamente acoplados por CRD | Servidor monolítico único + repo-server |
| **UI** | Mínima (Weave GitOps OSS) | Interface web completa |
| **Multi-tenancy** | Tenants Flux via CRDs com namespace | Projects + RBAC |
| **Automação de imagem** | Integrada via CRDs ImagePolicy | Argocd-image-updater (projeto separado) |
| **Notificação** | notification-controller | argocd-notifications |
| **Suporte a Helm** | HelmRelease CRD | Nativo, ciclo de vida completo |
| **Kustomize** | Kustomization CRD | Suporte nativo a overlays |
| **Multi-cluster** | Um Flux por cluster | Hub centralizado + spoke com agente |

---

## Segredos no GitOps

### SOPS — Criptografar segredos no Git

O SOPS criptografa apenas os valores em arquivos YAML/JSON, mantendo as chaves legíveis.

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

O Flux integra o SOPS nativamente — armazene a chave privada age como um secret K8s:

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

O ESO sincroniza segredos de stores externos (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, HashiCorp Vault) em Kubernetes Secrets.

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

## Layout de Repositório Multi-Cluster

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
