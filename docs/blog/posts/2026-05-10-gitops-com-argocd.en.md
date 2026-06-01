---
date: 2026-05-10
authors:
  - leonardoscampos
categories:
  - IaC
  - Containers
tags:
  - gitops
  - argocd
  - kubernetes
  - flux
---

# GitOps with ArgoCD: From Concept to Production

GitOps is one of the most impactful paradigm shifts I've implemented in recent years. The idea is simple: **Git is the single source of truth for cluster state**. What's in the repository is what should be running. Any divergence is detected and automatically corrected.

<!-- more -->

## Why GitOps changes everything

Before GitOps, the typical deploy flow was:

```
CI build → push image → engineer runs kubectl apply → hope for the best
```

With GitOps:

```
CI build → push image → update manifest in Git → ArgoCD syncs automatically
```

The crucial difference: **the cluster never accepts direct commands**. Everything goes through Git. This means complete auditing, trivial rollback (`git revert`) and reproducible deploys.

## Installing ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for pods to be ready
kubectl wait --for=condition=available deployment \
  -l app.kubernetes.io/name=argocd-server \
  -n argocd --timeout=120s
```

## Repository structure

The separation that works best in practice:

```
app-repo/           # Source code + Dockerfile
  src/
  Dockerfile
  .github/workflows/

infra-repo/         # Kubernetes manifests
  apps/
    production/
      my-api/
        deployment.yaml
        service.yaml
        kustomization.yaml
    staging/
      my-api/
        kustomization.yaml   # only overrides what changes
```

Never mix source code with infra manifests. Different teams, different cycles, different permissions.

## Application: ArgoCD's central object

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/my-org/infra-repo
    targetRevision: main
    path: apps/production/my-api
  destination:
    server: https://kubernetes.default.svc
    namespace: my-api
  syncPolicy:
    automated:
      prune: true      # removes resources that disappeared from Git
      selfHeal: true   # reverts manual changes in the cluster
    syncOptions:
      - CreateNamespace=true
```

!!! warning "Be careful with `prune: true` in production"
    Enable `prune` gradually. It removes resources that no longer exist in Git — useful, but dangerous if the manifests are incomplete.

## Image Updater: automatically updating the image

ArgoCD Image Updater monitors the registry and automatically updates the manifest when a new image is published:

```yaml
# Annotations on the Application
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: my-api=ghcr.io/my-org/my-api
    argocd-image-updater.argoproj.io/my-api.update-strategy: semver
    argocd-image-updater.argoproj.io/my-api.allow-tags: regexp:^v[0-9]+\.[0-9]+\.[0-9]+$
    argocd-image-updater.argoproj.io/write-back-method: git
```

## Sync strategy per environment

| Environment | Auto sync | Prune | Self-heal | Approval |
|---|---|---|---|---|
| Dev | ✓ | ✓ | ✓ | No |
| Staging | ✓ | ✓ | ✓ | No |
| Production | Manual | ✓ | ✓ | Yes (CODEOWNERS) |

In production, manual sync ensures a human reviews the diff before applying. ArgoCD shows exactly what will change.

## Rollback in seconds

```bash
# View deploy history
argocd app history my-api

# Rollback to a previous revision
argocd app rollback my-api <revision-id>

# Or simply via Git
git revert HEAD
git push
```

!!! tip "Git revert is the preferred rollback"
    Prefer `git revert` over ArgoCD rollback — it keeps the history clean and creates an auditable record of the action.

## Conclusion

GitOps with ArgoCD transformed how my team operates Kubernetes. The concrete gains:

- **Complete audit trail**: every change has an associated commit
- **Fast rollback**: `git revert` in seconds
- **Fewer human errors**: no one runs `kubectl apply` directly in production
- **Easier onboarding**: new members understand the cluster state by looking at the repo
