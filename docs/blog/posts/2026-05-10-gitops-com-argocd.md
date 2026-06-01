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

# GitOps com ArgoCD: Do Conceito à Produção

GitOps é uma das mudanças de paradigma mais impactantes que implementei nos últimos anos. A ideia é simples: **Git é a única fonte de verdade para o estado do cluster**. O que está no repositório é o que deve estar rodando. Qualquer divergência é detectada e corrigida automaticamente.

<!-- more -->

## Por que GitOps muda tudo

Antes do GitOps, o fluxo de deploy típico era:

```
CI build → push imagem → engenheiro roda kubectl apply → torce para dar certo
```

Com GitOps:

```
CI build → push imagem → atualiza manifesto no Git → ArgoCD sincroniza automaticamente
```

A diferença crucial: **o cluster nunca aceita comandos diretos**. Tudo passa pelo Git. Isso significa auditoria completa, rollback trivial (`git revert`) e deploys reproduzíveis.

## Instalando o ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f \
  https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Aguardar pods ficarem prontos
kubectl wait --for=condition=available deployment \
  -l app.kubernetes.io/name=argocd-server \
  -n argocd --timeout=120s
```

## Estrutura de repositórios

A separação que funciona melhor na prática:

```
app-repo/           # Código fonte + Dockerfile
  src/
  Dockerfile
  .github/workflows/

infra-repo/         # Manifestos Kubernetes
  apps/
    production/
      my-api/
        deployment.yaml
        service.yaml
        kustomization.yaml
    staging/
      my-api/
        kustomization.yaml   # só sobrescreve o que muda
```

Nunca misture código fonte com manifestos de infra. Times diferentes, ciclos diferentes, permissões diferentes.

## Application: o objeto central do ArgoCD

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
      prune: true      # remove recursos que sumiram do Git
      selfHeal: true   # reverte mudanças manuais no cluster
    syncOptions:
      - CreateNamespace=true
```

!!! warning "Cuidado com `prune: true` em produção"
    Habilite `prune` gradualmente. Ele remove recursos que não existem mais no Git — útil, mas perigoso se os manifestos estiverem incompletos.

## Image Updater: atualizando a imagem automaticamente

O ArgoCD Image Updater monitora o registry e atualiza automaticamente o manifesto quando uma nova imagem é publicada:

```yaml
# Anotações na Application
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: my-api=ghcr.io/my-org/my-api
    argocd-image-updater.argoproj.io/my-api.update-strategy: semver
    argocd-image-updater.argoproj.io/my-api.allow-tags: regexp:^v[0-9]+\.[0-9]+\.[0-9]+$
    argocd-image-updater.argoproj.io/write-back-method: git
```

## Estratégia de sync por ambiente

| Ambiente | Sync automático | Prune | Self-heal | Aprovação |
|----------|----------------|-------|-----------|-----------|
| Dev | ✓ | ✓ | ✓ | Não |
| Staging | ✓ | ✓ | ✓ | Não |
| Produção | Manual | ✓ | ✓ | Sim (CODEOWNERS) |

Em produção, o sync manual garante que um humano revise o diff antes de aplicar. O ArgoCD mostra exatamente o que vai mudar.

## Rollback em segundos

```bash
# Ver histórico de deploys
argocd app history my-api

# Rollback para revisão anterior
argocd app rollback my-api <revision-id>

# Ou simplesmente via Git
git revert HEAD
git push
```

!!! tip "Git revert é o rollback preferido"
    Prefira `git revert` ao rollback pelo ArgoCD — ele mantém o histórico limpo e cria um registro auditável da ação.

## Conclusão

GitOps com ArgoCD transformou como meu time opera Kubernetes. Os ganhos concretos:

- **Auditoria completa**: cada mudança tem um commit associado
- **Rollback rápido**: `git revert` em segundos
- **Menos erros humanos**: ninguém roda `kubectl apply` direto em produção
- **Onboarding mais fácil**: novos membros entendem o estado do cluster olhando o repo

O investimento inicial na estrutura de repositórios e nos manifestos paga dividendos desde o primeiro incidente que você precisa resolver rapidamente.
