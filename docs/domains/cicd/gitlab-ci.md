---
title: GitLab CI
description: GitLab CI/CD pipelines, stages, runners, include/extends, environments and Auto DevOps reference.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / gitlab-ci</span>
    <h1 class="dph-title">GitLab CI</h1>
    <p class="dph-desc">GitLab's built-in CI/CD system. Pipelines defined in `.gitlab-ci.yml` with powerful include/extends templating, DAG job dependencies, dynamic child pipelines, built-in container registry and deep integration with GitLab Environments and review apps.</p>
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

[← GitHub Actions](github-actions.md) | [← CI/CD Overview](index.md) | [Jenkins →](jenkins.md)

---

## Pipeline Anatomy

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

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Pipeline** | A collection of jobs grouped in stages, triggered by an event |
| **Stage** | Logical grouping; jobs in the same stage run in parallel |
| **Job** | Atomic unit of work — runs on a runner |
| **Runner** | Agent executing jobs: shared, group, or project-scoped |
| **Artifact** | File(s) produced by a job, passed downstream or stored |
| **Cache** | Dependencies stored between pipeline runs (per runner) |
| **Environment** | Named deployment target with URL, history and rollback |
| **Rules** | Conditional logic controlling when jobs are included |
| **Needs** | DAG dependency — run a job before its stage starts |

---

## Predefined Variables Reference

| Variable | Value |
|----------|-------|
| `$CI_COMMIT_SHA` | Full commit SHA |
| `$CI_COMMIT_SHORT_SHA` | First 8 chars |
| `$CI_COMMIT_BRANCH` | Branch name (push pipelines) |
| `$CI_COMMIT_TAG` | Tag name (tag pipelines) |
| `$CI_MERGE_REQUEST_IID` | MR IID (MR pipelines) |
| `$CI_PROJECT_PATH` | `namespace/project` |
| `$CI_REGISTRY` | GitLab Container Registry host |
| `$CI_REGISTRY_IMAGE` | Full registry path for this project |
| `$CI_REGISTRY_USER` | Auto registry user |
| `$CI_REGISTRY_PASSWORD` | Auto registry token |
| `$CI_PIPELINE_SOURCE` | `push`, `merge_request_event`, `schedule`, `api`… |
| `$CI_ENVIRONMENT_NAME` | Current deployment environment |

---

## Include & Extends Templates

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

## DAG Pipelines with `needs`

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

## Dynamic Child Pipelines

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

## Runners Configuration

=== "Shared (GitLab.com)"

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

## Container Registry

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

## Security Scanning (built-in templates)

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

## Environments & Deployments

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

## Caching

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

## Best Practices

| Practice | Implementation |
|----------|---------------|
| **Use rules over only/except** | `rules:` supports complex conditions; `only/except` is legacy |
| **DAG with needs** | Reduces pipeline duration — jobs start ASAP |
| **Reuse with extends/.base-* jobs** | Prefix hidden jobs with `.` to avoid execution |
| **Pin image versions** | `image: node:20.13.1` not `node:latest` |
| **Artifacts expire_in** | Set short expiry for build artifacts, longer for test reports |
| **Group variables** | Use Group CI/CD variables for secrets shared across projects |
| **Protected variables** | Mark secrets as `Protected` — only exposed on protected branches/tags |
| **Masked variables** | Enable masking to redact from job logs |
| **Least-privilege tokens** | Use project tokens with minimal scopes; rotate regularly |
| **DAST on review apps** | Run dynamic scanning against ephemeral review environments |

[← GitHub Actions](github-actions.md) | [← CI/CD Overview](index.md) | [Jenkins →](jenkins.md)
