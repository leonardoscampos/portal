---
title: Policy as Code
description: OPA, Gatekeeper, Kyverno — admission control, compliance guardrails, and policy enforcement across Kubernetes and CI/CD.
---

<div class="domain-page-hero" data-domain="security">
  <div class="dph-left">
    <span class="dph-eyebrow">// security-devsecops / policy-as-code</span>
    <h1 class="dph-title">Policy as Code</h1>
    <p class="dph-desc">Policy as Code encodes compliance, security, and operational rules in version-controlled, testable policy files. Admission controllers enforce policies at the Kubernetes API boundary — blocking or mutating non-compliant resources before they are persisted.</p>
    <div class="dph-badges">
      <span class="tech-badge">OPA</span>
      <span class="tech-badge">Gatekeeper</span>
      <span class="tech-badge">Kyverno</span>
      <span class="tech-badge">Conftest</span>
      <span class="tech-badge">Rego</span>
      <span class="tech-badge">Admission Webhooks</span>
    </div>
  </div>
</div>

[← Secrets Management](secrets.md) | [← Security Overview](index.md) | [Vulnerability Scanning →](vulnerability-scanning.md)

---

## OPA Gatekeeper

### Installation

```bash
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helm upgrade --install gatekeeper gatekeeper/gatekeeper \
  --namespace gatekeeper-system --create-namespace \
  --set replicas=3 \
  --set controllerManager.resources.limits.memory=512Mi \
  --set audit.resources.limits.memory=512Mi
```

### ConstraintTemplate + Constraint

```yaml
# ConstraintTemplate — defines the schema and Rego logic
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels

        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing  := required - provided
          count(missing) > 0
          msg := sprintf("Missing required labels: %v", [missing])
        }
---
# Constraint — applies the template to a scope
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-team-label
spec:
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: ["Deployment", "StatefulSet"]
    namespaces: [production, staging]
  parameters:
    labels: ["app.kubernetes.io/name", "app.kubernetes.io/version", "team"]
```

### Common Gatekeeper Policies

=== "Block latest tag"

    ```yaml
    apiVersion: templates.gatekeeper.sh/v1
    kind: ConstraintTemplate
    metadata:
      name: k8sblocklatestimage
    spec:
      crd:
        spec:
          names:
            kind: K8sBlockLatestImage
      targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
            package k8sblocklatestimage

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              endswith(container.image, ":latest")
              msg := sprintf("Container '%v' uses :latest tag — pin to a digest", [container.name])
            }

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              not contains(container.image, ":")
              msg := sprintf("Container '%v' has no tag — pin to a digest", [container.name])
            }
    ```

=== "Require resource limits"

    ```yaml
    apiVersion: templates.gatekeeper.sh/v1
    kind: ConstraintTemplate
    metadata:
      name: k8srequiredresources
    spec:
      crd:
        spec:
          names:
            kind: K8sRequiredResources
      targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
            package k8srequiredresources

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              not container.resources.limits.memory
              msg := sprintf("Container '%v' has no memory limit", [container.name])
            }

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              not container.resources.limits.cpu
              msg := sprintf("Container '%v' has no CPU limit", [container.name])
            }

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              not container.resources.requests.memory
              msg := sprintf("Container '%v' has no memory request", [container.name])
            }
    ```

=== "Disallow privileged containers"

    ```yaml
    apiVersion: templates.gatekeeper.sh/v1
    kind: ConstraintTemplate
    metadata:
      name: k8sdisallowprivileged
    spec:
      crd:
        spec:
          names:
            kind: K8sDisallowPrivileged
      targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
            package k8sdisallowprivileged

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              container.securityContext.privileged == true
              msg := sprintf("Container '%v' is privileged — remove securityContext.privileged", [container.name])
            }

            violation[{"msg": msg}] {
              container := input.review.object.spec.initContainers[_]
              container.securityContext.privileged == true
              msg := sprintf("Init container '%v' is privileged", [container.name])
            }
    ```

=== "Require non-root user"

    ```yaml
    apiVersion: templates.gatekeeper.sh/v1
    kind: ConstraintTemplate
    metadata:
      name: k8snonrootuser
    spec:
      crd:
        spec:
          names:
            kind: K8sNonRootUser
      targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
            package k8snonrootuser

            violation[{"msg": msg}] {
              container := input.review.object.spec.containers[_]
              not container.securityContext.runAsNonRoot == true
              not container.securityContext.runAsUser > 0
              msg := sprintf("Container '%v' must run as non-root", [container.name])
            }
    ```

### Gatekeeper Audit

```bash
# Check constraint violations across the cluster
kubectl get constraints
kubectl describe k8srequiredlabels require-team-label
# Shows: .status.violations — all non-compliant resources
```

---

## Kyverno

### Installation

```bash
helm upgrade --install kyverno kyverno/kyverno \
  --namespace kyverno --create-namespace \
  --set replicaCount=3 \
  --set admissionController.resources.limits.memory=384Mi
```

### Validate Policy

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
  annotations:
    policies.kyverno.io/title: Disallow Latest Tag
    policies.kyverno.io/severity: medium
    policies.kyverno.io/description: >-
      Require container images to use a specific tag, not :latest.
spec:
  validationFailureAction: Enforce    # or Audit
  background: true                    # audit existing resources
  rules:
    - name: require-image-tag
      match:
        any:
          - resources:
              kinds: [Pod]
              namespaces: [production, staging]
      validate:
        message: "Image tag :latest or missing tag is not allowed"
        pattern:
          spec:
            containers:
              - image: "*:*"
                (image): "!*:latest"
```

### Mutate Policy

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-default-labels
spec:
  rules:
    - name: add-labels
      match:
        any:
          - resources:
              kinds: [Deployment, StatefulSet]
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              +(managed-by): kyverno
              +(env): "{{ request.namespace }}"
```

### Generate Policy (NetworkPolicy on namespace creation)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: default-networkpolicy
spec:
  rules:
    - name: default-deny-ingress
      match:
        any:
          - resources:
              kinds: [Namespace]
      generate:
        apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        name: default-deny-ingress
        namespace: "{{request.object.metadata.name}}"
        synchronize: true
        data:
          spec:
            podSelector: {}
            policyTypes: [Ingress]
```

### Verify Image Signatures (Supply Chain)

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Enforce
  webhookTimeoutSeconds: 30
  rules:
    - name: check-signature
      match:
        any:
          - resources:
              kinds: [Pod]
              namespaces: [production]
      verifyImages:
        - imageReferences:
            - "ghcr.io/my-org/*"
          attestors:
            - count: 1
              entries:
                - keyless:
                    subject: "https://github.com/my-org/my-repo/.github/workflows/release.yaml@refs/heads/main"
                    issuer: "https://token.actions.githubusercontent.com"
                    rekor:
                      url: https://rekor.sigstore.dev
```

---

## OPA + Conftest (CI enforcement)

```bash
# Install conftest
brew install conftest

# Test Terraform plan, Kubernetes manifests, Dockerfile, etc.
conftest test deployment.yaml --policy policy/
conftest test terraform.plan.json --policy policy/
conftest test Dockerfile --policy policy/
```

```rego
# policy/kubernetes.rego
package main

import future.keywords.if
import future.keywords.every

# Deny Deployments without resource limits
deny[msg] if {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.resources.limits
  msg := sprintf("Deployment '%v': container '%v' has no resource limits",
    [input.metadata.name, container.name])
}

# Deny images from untrusted registries
allowed_registries := {"gcr.io", "ghcr.io", "registry.k8s.io", "quay.io"}

deny[msg] if {
  container := input.spec.template.spec.containers[_]
  image_parts := split(container.image, "/")
  count(image_parts) >= 2
  registry := image_parts[0]
  not allowed_registries[registry]
  msg := sprintf("Container '%v' uses untrusted registry: %v",
    [container.name, registry])
}

# Warn on missing readiness probe
warn[msg] if {
  input.kind == "Deployment"
  container := input.spec.template.spec.containers[_]
  not container.readinessProbe
  msg := sprintf("Container '%v' has no readinessProbe", [container.name])
}
```

```yaml
# GitHub Actions — conftest gate
- name: Policy check
  run: |
    conftest test \
      --policy policy/ \
      --all-namespaces \
      k8s/production/*.yaml
```

---

## OPA Decision Logs

```yaml
# OPA standalone — decision logging
opa run \
  --server \
  --log-level=info \
  --log-format=json-pretty \
  --set decision_logs.console=true \
  --set decision_logs.reporting.min_delay_seconds=300 \
  --set decision_logs.reporting.max_delay_seconds=600 \
  --set services.acmecorp.url=https://example.com/opa-logs \
  --bundle bundle.tar.gz
```

---

## Policy Coverage Matrix

| Policy | Gatekeeper | Kyverno | Conftest |
|--------|-----------|---------|---------|
| Block `:latest` tag | ConstraintTemplate | ClusterPolicy validate | Rego rule |
| Require resource limits | ConstraintTemplate | ClusterPolicy validate | Rego rule |
| Require non-root | ConstraintTemplate | ClusterPolicy validate | Rego rule |
| Disallow privileged | ConstraintTemplate | ClusterPolicy validate | — |
| Auto-add labels | — | ClusterPolicy mutate | — |
| Generate NetworkPolicy | — | ClusterPolicy generate | — |
| Verify image signature | — | ClusterPolicy verifyImages | — |
| Terraform compliance | — | — | Rego policy |
| Dockerfile best practices | — | — | Rego policy |

[← Secrets Management](secrets.md) | [← Security Overview](index.md) | [Vulnerability Scanning →](vulnerability-scanning.md)
