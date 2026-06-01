---
title: GitLab CI
description: Pipelines, estágios, runners, include/extends, ambientes e referência de Auto DevOps do GitLab CI/CD.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / gitlab-ci</span>
    <h1 class="dph-title">GitLab CI</h1>
    <p class="dph-desc">Sistema de CI/CD integrado do GitLab. Pipelines definidos em `.gitlab-ci.yml` com poderoso templating via include/extends, dependências de jobs em DAG, child pipelines dinâmicos, registro de containers integrado e integração profunda com GitLab Environments e review apps.</p>
    <div class="dph-badges">
      <span class="tech-badge">Pipelines</span>
      <span class="tech-badge">Runners</span>
      <span class="tech-badge">Stages</span>
      <span class="tech-badge">Include / Extends</span>
      <span class="tech-badge">Environments</span>
      <span class="tech-badge">Auto DevOps</span>
    </div>
  </div>
</div>

[← GitHub Actions](github-actions.md) | [← Visão Geral de CI/CD](index.md) | [Jenkins →](jenkins.md)

---

## Anatomia do Pipeline

```yaml
# .gitlab-ci.yml
image: docker:25

stages:
  - build
  - test
  - scan
  - deploy

variables:
  DOCKER_DRIVER: overlay2
  REGISTRY: $CI_REGISTRY_IMAGE
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA

# ─── Build ──────────────────────────────────────────
build-image:
  stage: build
  services:
    - docker:25-dind
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $REGISTRY:$IMAGE_TAG .
    - docker push $REGISTRY:$IMAGE_TAG
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

# ─── Test ───────────────────────────────────────────
unit-tests:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r requirements.txt
    - pytest --junitxml=report.xml --cov=app tests/unit/
  artifacts:
    reports:
      junit: report.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage.xml
    expire_in: 1 week

# ─── Deploy ─────────────────────────────────────────
deploy-staging:
  stage: deploy
  environment:
    name: staging
    url: https://staging.example.com
  script:
    - kubectl set image deployment/app app=$REGISTRY:$IMAGE_TAG
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

---

## Conceitos Principais

| Conceito | Descrição |
|---------|-------------|
| **Pipeline** | Coleção de jobs agrupados em estágios, disparada por um evento |
| **Stage** | Agrupamento lógico; jobs no mesmo estágio rodam em paralelo |
| **Job** | Unidade atômica de trabalho — executada em um runner |
| **Runner** | Agente que executa os jobs: compartilhado, por grupo ou por projeto |
| **Artifact** | Arquivo(s) produzido(s) por um job, passado(s) adiante ou armazenado(s) |
| **Cache** | Dependências armazenadas entre execuções de pipeline (por runner) |
| **Environment** | Destino de implantação nomeado com URL, histórico e rollback |
| **Rules** | Lógica condicional que controla quando os jobs são incluídos |
| **Needs** | Dependência em DAG — executa um job antes que seu estágio inicie |

---

## Referência de Variáveis Predefinidas

| Variável | Valor |
|----------|-------|
| `$CI_COMMIT_SHA` | SHA completo do commit |
| `$CI_COMMIT_SHORT_SHA` | Primeiros 8 caracteres |
| `$CI_COMMIT_BRANCH` | Nome do branch (pipelines de push) |
| `$CI_COMMIT_TAG` | Nome da tag (pipelines de tag) |
| `$CI_MERGE_REQUEST_IID` | IID do MR (pipelines de MR) |
| `$CI_PROJECT_PATH` | `namespace/projeto` |
| `$CI_REGISTRY` | Host do registro de containers do GitLab |
| `$CI_REGISTRY_IMAGE` | Caminho completo do registro para este projeto |
| `$CI_REGISTRY_USER` | Usuário automático do registro |
| `$CI_REGISTRY_PASSWORD` | Token automático do registro |
| `$CI_PIPELINE_SOURCE` | `push`, `merge_request_event`, `schedule`, `api`… |
| `$CI_ENVIRONMENT_NAME` | Ambiente de implantação atual |

---

## Templates com Include & Extends

=== "include"

    ```yaml
    # .gitlab-ci.yml
    include:
      # Include from same project
      - local: .gitlab/ci/build.yml

      # Include from another project
      - project: my-group/shared-ci-templates
        ref: main
        file: /templates/docker.yml

      # Include from URL
      - remote: https://example.com/ci/template.yml

      # GitLab-provided template
      - template: Security/SAST.gitlab-ci.yml
    ```

=== "extends"

    ```yaml
    # Shared base job
    .base-deploy:
      image: bitnami/kubectl:1.30
      before_script:
        - kubectl config use-context $KUBE_CONTEXT
      script:
        - kubectl set image deployment/app app=$REGISTRY:$IMAGE_TAG

    # Concrete job that extends base
    deploy-staging:
      extends: .base-deploy
      stage: deploy
      variables:
        KUBE_CONTEXT: staging-cluster
      environment:
        name: staging
        url: https://staging.example.com

    deploy-prod:
      extends: .base-deploy
      stage: deploy
      variables:
        KUBE_CONTEXT: prod-cluster
      environment:
        name: production
        url: https://app.example.com
      when: manual
    ```

---

## Rules vs only/except

```yaml
# Preferred: rules (more powerful)
deploy-prod:
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/    # semantic version tag
      when: manual
    - if: $CI_COMMIT_BRANCH == "main"
      when: on_success
    - changes:                                       # run only if files changed
        - helm/**/*
        - Dockerfile
      when: on_success
    - when: never                                    # default: skip

# Legacy (avoid for new pipelines)
deploy-legacy:
  only:
    - main
  except:
    - schedules
```

---

## Pipelines em DAG com `needs`

```yaml
stages:
  - build
  - test
  - deploy

build-backend:
  stage: build
  script: docker build -t backend .

build-frontend:
  stage: build
  script: docker build -t frontend .

test-backend:
  stage: test
  needs: [build-backend]       # starts as soon as build-backend finishes
  script: go test ./...

test-frontend:
  stage: test
  needs: [build-frontend]      # runs in parallel with test-backend
  script: npm test

deploy:
  stage: deploy
  needs: [test-backend, test-frontend]
  script: ./deploy.sh
```

---

## Child Pipelines Dinâmicos

```yaml
# Parent pipeline
generate-config:
  stage: build
  script:
    - python scripts/generate_child_pipeline.py > generated-pipeline.yml
  artifacts:
    paths: [generated-pipeline.yml]

trigger-child:
  stage: test
  trigger:
    include:
      - artifact: generated-pipeline.yml
        job: generate-config
    strategy: depend           # parent waits for child
```

---

## Configuração de Runners

=== "Compartilhado (GitLab.com)"

    ```yaml
    # Uses GitLab-hosted shared runners — no setup needed
    job:
      image: node:20
      script: npm ci && npm test
      tags: []                  # no tags = uses any available runner
    ```

=== "Self-hosted (Docker)"

    ```bash
    # Install GitLab Runner
    curl -L https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh | sudo bash
    sudo apt-get install gitlab-runner

    # Register
    gitlab-runner register \
      --url https://gitlab.example.com \
      --token glrt-xxxxxxxxxxxx \
      --executor docker \
      --docker-image alpine:latest \
      --description "docker-runner"
    ```

=== "Kubernetes Executor"

    ```yaml
    # config.toml
    [[runners]]
      name = "k8s-runner"
      url = "https://gitlab.com"
      token = "glrt-xxxxxxxxxxxx"
      executor = "kubernetes"

      [runners.kubernetes]
        namespace = "gitlab-runners"
        image = "alpine:latest"
        cpu_request = "100m"
        memory_request = "128Mi"
        cpu_limit = "2"
        memory_limit = "2Gi"

        [[runners.kubernetes.volumes.empty_dir]]
          name = "repo"
          mount_path = "/builds"
    ```

---

## Registro de Containers

```yaml
variables:
  IMAGE: $CI_REGISTRY_IMAGE/$CI_COMMIT_REF_SLUG:$CI_COMMIT_SHORT_SHA

build:
  stage: build
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
  script:
    - docker build -t $IMAGE .
    - docker push $IMAGE
    - docker tag $IMAGE $CI_REGISTRY_IMAGE:latest
    - docker push $CI_REGISTRY_IMAGE:latest
```

---

## Varredura de Segurança (templates integrados)

```yaml
include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Secret-Detection.gitlab-ci.yml
  - template: Security/Dependency-Scanning.gitlab-ci.yml
  - template: Security/Container-Scanning.gitlab-ci.yml
  - template: Security/DAST.gitlab-ci.yml

# Override template variables
variables:
  SAST_EXCLUDED_PATHS: "spec, test, tests, tmp"
  CS_IMAGE: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA
  DAST_WEBSITE: https://staging.example.com
```

---

## Ambientes e Implantações

```yaml
deploy-staging:
  stage: deploy
  environment:
    name: staging
    url: https://staging.example.com
    on_stop: stop-staging        # link to teardown job

  script:
    - helm upgrade --install app ./helm -f values-staging.yaml

stop-staging:
  stage: deploy
  environment:
    name: staging
    action: stop
  script:
    - helm uninstall app
  when: manual
  rules:
    - if: $CI_MERGE_REQUEST_IID

# Review apps (one per MR)
deploy-review:
  stage: deploy
  environment:
    name: review/$CI_MERGE_REQUEST_IID
    url: https://review-$CI_MERGE_REQUEST_IID.example.com
    on_stop: stop-review
  script:
    - helm upgrade --install review-$CI_MERGE_REQUEST_IID ./helm
  rules:
    - if: $CI_MERGE_REQUEST_IID
```

---

## Cache

```yaml
cache:
  # Global cache definition
  key: $CI_COMMIT_REF_SLUG
  paths:
    - node_modules/
    - .npm/

test:
  cache:
    key:
      files:
        - package-lock.json     # invalidate when lockfile changes
    paths:
      - node_modules/
    policy: pull-push           # pull at start, push at end (default)

build:
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - node_modules/
    policy: pull                # read-only — don't update cache
```

---

## Boas Práticas

| Prática | Implementação |
|----------|---------------|
| **Use rules em vez de only/except** | `rules:` suporta condições complexas; `only/except` é legado |
| **DAG com needs** | Reduz a duração do pipeline — jobs iniciam o mais rápido possível |
| **Reutilize com extends/.base-*** | Prefixe jobs ocultos com `.` para evitar execução |
| **Fixe versões de imagem** | `image: node:20.13.1` e não `node:latest` |
| **expire_in para artefatos** | Defina validade curta para artefatos de build, maior para relatórios de teste |
| **Variáveis de grupo** | Use variáveis CI/CD de grupo para segredos compartilhados entre projetos |
| **Variáveis protegidas** | Marque segredos como `Protected` — expostos apenas em branches/tags protegidos |
| **Variáveis mascaradas** | Ative o mascaramento para ocultar nos logs dos jobs |
| **Tokens com privilégios mínimos** | Use tokens de projeto com escopos mínimos; rotacione regularmente |
| **DAST em review apps** | Execute varredura dinâmica em ambientes de review efêmeros |

[← GitHub Actions](github-actions.md) | [← Visão Geral de CI/CD](index.md) | [Jenkins →](jenkins.md)
