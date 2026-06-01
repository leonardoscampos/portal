---
title: Helm
description: Helm chart structure, values, templating, Helmfile, OCI registries and chart testing reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / helm</span>
    <h1 class="dph-title">Helm</h1>
    <p class="dph-desc">The package manager for Kubernetes. Helm charts bundle Kubernetes manifests with configurable values, enabling repeatable deployments across environments. Helmfile manages multiple releases declaratively across clusters.</p>
    <div class="dph-badges">
      <span class="tech-badge">Charts</span>
      <span class="tech-badge">Values</span>
      <span class="tech-badge">Templates</span>
      <span class="tech-badge">Helmfile</span>
      <span class="tech-badge">OCI Registry</span>
      <span class="tech-badge">chart-testing</span>
    </div>
  </div>
</div>

[← Pulumi](pulumi.md) | [← IaC Overview](index.md) | [GitOps →](gitops.md)

---

## Chart Structure

```
my-app/
├── Chart.yaml            # chart metadata
├── values.yaml           # default values
├── values-prod.yaml      # environment override (not packaged)
├── .helmignore
├── templates/
│   ├── _helpers.tpl      # named templates / helpers
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── serviceaccount.yaml
│   └── NOTES.txt         # post-install instructions
└── charts/               # chart dependencies (subcharts)
```

```yaml
# Chart.yaml
apiVersion: v2
name: my-app
description: "Production-grade web application"
type: application
version: "1.4.0"      # chart version
appVersion: "2.3.1"   # app version (informational)

dependencies:
  - name: postgresql
    version: "14.3.3"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
```

---

## values.yaml

```yaml
replicaCount: 2

image:
  repository: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app
  tag: ""          # defaults to Chart.appVersion if empty
  pullPolicy: IfNotPresent

serviceAccount:
  create: true
  annotations: {}

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

ingress:
  enabled: false
  className: nginx
  annotations: {}
  hosts:
    - host: app.example.com
      paths:
        - path: /
          pathType: Prefix
  tls: []

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

postgresql:
  enabled: false

env: {}
envFrom: []
```

---

## Templates

### `_helpers.tpl`

```yaml
{{/* Expand the name of the chart */}}
{{- define "my-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Selector labels */}}
{{- define "my-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Common labels */}}
{{- define "my-app.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{ include "my-app.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
```

### `deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "my-app.name" . }}
  labels:
    {{- include "my-app.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "my-app.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "my-app.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "my-app.name" . }}
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.targetPort }}
          {{- with .Values.env }}
          env:
            {{- range $key, $value := . }}
            - name: {{ $key }}
              value: {{ $value | quote }}
            {{- end }}
          {{- end }}
          {{- with .Values.envFrom }}
          envFrom:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          readinessProbe:
            httpGet:
              path: /healthz
              port: {{ .Values.service.targetPort }}
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: {{ .Values.service.targetPort }}
            initialDelaySeconds: 15
            periodSeconds: 20
```

---

## Core CLI Commands

```bash
# Add and update a chart repository
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Search for charts
helm search repo nginx
helm search hub prometheus

# Install / upgrade (idempotent with upgrade --install)
helm upgrade --install my-app ./my-app \
  --namespace production \
  --create-namespace \
  --values values-prod.yaml \
  --set image.tag=v2.3.1 \
  --wait \
  --timeout 5m

# Preview rendered templates without installing
helm template my-app ./my-app --values values-prod.yaml

# Show computed values for a deployed release
helm get values my-app -n production

# List releases
helm list -A

# Rollback to previous revision
helm rollback my-app 2 -n production

# Uninstall
helm uninstall my-app -n production
```

---

## OCI Registry

Helm 3.8+ supports storing and pulling charts from OCI-compliant registries (ECR, ACR, GAR, Docker Hub).

```bash
# Push to AWS ECR
aws ecr create-repository --repository-name helm-charts/my-app

aws ecr get-login-password --region us-east-1 | \
  helm registry login \
    --username AWS \
    --password-stdin \
    123456789012.dkr.ecr.us-east-1.amazonaws.com

helm package ./my-app
helm push my-app-1.4.0.tgz oci://123456789012.dkr.ecr.us-east-1.amazonaws.com/helm-charts

# Pull and install from OCI
helm upgrade --install my-app \
  oci://123456789012.dkr.ecr.us-east-1.amazonaws.com/helm-charts/my-app \
  --version 1.4.0 \
  --namespace production
```

---

## Helmfile

Helmfile declares all Helm releases for an environment in a single YAML file, enabling `helmfile apply` as a single idempotent operation.

```yaml
# helmfile.yaml
repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami
  - name: ingress-nginx
    url: https://kubernetes.github.io/ingress-nginx
  - name: cert-manager
    url: https://charts.jetstack.io

environments:
  dev:
    values:
      - environments/dev.yaml
  prod:
    values:
      - environments/prod.yaml

releases:
  - name: ingress-nginx
    namespace: ingress-nginx
    chart: ingress-nginx/ingress-nginx
    version: "4.10.0"
    createNamespace: true

  - name: cert-manager
    namespace: cert-manager
    chart: cert-manager/cert-manager
    version: "v1.14.5"
    createNamespace: true
    set:
      - name: installCRDs
        value: "true"

  - name: postgresql
    namespace: databases
    chart: bitnami/postgresql
    version: "14.3.3"
    createNamespace: true
    values:
      - charts/postgresql/values.yaml
      - charts/postgresql/values-{{ .Environment.Name }}.yaml

  - name: my-app
    namespace: production
    chart: ./charts/my-app
    needs:
      - ingress-nginx/ingress-nginx
      - cert-manager/cert-manager
    values:
      - charts/my-app/values.yaml
      - charts/my-app/values-{{ .Environment.Name }}.yaml
    set:
      - name: image.tag
        value: {{ env "IMAGE_TAG" | default "latest" }}
```

```bash
helmfile --environment prod apply
helmfile --environment prod diff
helmfile --environment prod destroy
```

---

## Helm Hooks

Hooks let you run Jobs at specific lifecycle points.

```yaml
# templates/db-migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "my-app.name" . }}-db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": hook-succeeded
spec:
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          command: ["python", "manage.py", "migrate"]
          envFrom:
            - secretRef:
                name: {{ include "my-app.name" . }}-db-secret
```

| Hook | When it runs |
|------|-------------|
| `pre-install` | Before any resources are created |
| `post-install` | After all resources are installed |
| `pre-upgrade` | Before an upgrade begins |
| `post-upgrade` | After an upgrade succeeds |
| `pre-rollback` | Before a rollback begins |
| `post-rollback` | After a rollback succeeds |
| `pre-delete` | Before a release is deleted |
| `test` | When `helm test` is run |

---

## Chart Testing (ct)

`chart-testing` is the official lint + test tool for Helm charts, designed for CI.

```yaml
# .github/workflows/chart-test.yml
jobs:
  chart-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: helm/chart-testing-action@v2

      - name: Run chart-testing (lint)
        run: ct lint --chart-dirs charts

      - uses: helm/kind-action@v1

      - name: Run chart-testing (install)
        run: ct install --chart-dirs charts
```
