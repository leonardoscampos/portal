---
title: CircleCI
description: CircleCI orbs, workflows, caching, resource classes, Docker layer caching, contexts and parallelism reference.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / circle-ci</span>
    <h1 class="dph-title">CircleCI</h1>
    <p class="dph-desc">Fast, cloud-native CI/CD optimized for developer velocity. Orbs for instant integrations, intelligent test splitting for parallelism, Docker Layer Caching for faster builds, and Contexts for secure, org-wide secret management across pipelines.</p>
    <div class="dph-badges">
      <span class="tech-badge">Orbs</span>
      <span class="tech-badge">Workflows</span>
      <span class="tech-badge">Caching</span>
      <span class="tech-badge">DLC</span>
      <span class="tech-badge">Contexts</span>
      <span class="tech-badge">Resource Classes</span>
    </div>
  </div>
</div>

[← Azure DevOps](azure-devops.md) | [← CI/CD Overview](index.md)

---

## Config Anatomy

```yaml
# .circleci/config.yml
version: 2.1

orbs:
  node: circleci/node@6
  aws-ecr: circleci/aws-ecr@9
  aws-ecs: circleci/aws-ecs@4
  slack: circleci/slack@4

executors:
  node-executor:
    docker:
      - image: cimg/node:20.13
    resource_class: medium

parameters:
  run-integration-tests:
    type: boolean
    default: false

jobs:
  build-and-test:
    executor: node-executor
    steps:
      - checkout

      - node/install-packages:
          pkg-manager: npm

      - run:
          name: Build
          command: npm run build

      - run:
          name: Test
          command: npm test -- --ci --reporters=jest-junit
          environment:
            JEST_JUNIT_OUTPUT_DIR: ./test-results

      - store_test_results:
          path: ./test-results

      - store_artifacts:
          path: ./dist
          destination: build-artifacts

  build-push-image:
    machine:
      image: ubuntu-2204:current
      docker_layer_caching: true      # DLC — reuses Docker layer cache
    steps:
      - checkout
      - aws-ecr/build-and-push-image:
          account-id: AWS_ACCOUNT_ID
          region: us-east-1
          repo: my-app
          tag: $CIRCLE_SHA1,latest

  deploy-staging:
    docker:
      - image: cimg/python:3.12
    steps:
      - checkout
      - run:
          name: Install Helm
          command: |
            curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
      - run:
          name: Deploy
          command: |
            helm upgrade --install my-app ./helm \
              -f values-staging.yaml \
              --set image.tag=$CIRCLE_SHA1

  deploy-production:
    docker:
      - image: cimg/python:3.12
    steps:
      - checkout
      - run:
          name: Deploy to production
          command: |
            helm upgrade --install my-app ./helm \
              -f values-prod.yaml \
              --set image.tag=$CIRCLE_SHA1

workflows:
  build-test-deploy:
    jobs:
      - build-and-test:
          filters:
            branches:
              ignore: main

      - build-push-image:
          context:
            - aws-production            # org-level context with AWS credentials
          requires:
            - build-and-test
          filters:
            branches:
              only: main

      - deploy-staging:
          requires:
            - build-push-image
          filters:
            branches:
              only: main

      - hold-production:
          type: approval              # manual gate
          requires:
            - deploy-staging

      - deploy-production:
          context:
            - aws-production
          requires:
            - hold-production
          filters:
            branches:
              only: main
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Job** | Named set of steps running in an executor |
| **Step** | A `run` command, built-in step, or orb command |
| **Executor** | Runtime environment: Docker, machine, macOS, Windows |
| **Workflow** | DAG of jobs — defines ordering, conditions, approvals |
| **Orb** | Reusable package of jobs, commands and executors (like an action) |
| **Context** | Org-level or project-level secret store applied to jobs |
| **Cache** | Dependency cache persisted across pipeline runs |
| **Workspace** | Ephemeral data passing between jobs in the same workflow |
| **Resource class** | CPU/RAM tier for the executor |
| **DLC** | Docker Layer Caching — speeds up `docker build` across runs |

---

## Executors & Resource Classes

=== "Docker"

    ```yaml
    executors:
      small-node:
        docker:
          - image: cimg/node:20.13   # CircleCI convenience image
          - image: postgres:16       # service container
            environment:
              POSTGRES_PASSWORD: test
        resource_class: small        # 1 vCPU, 2 GB RAM
    ```

=== "Machine (Linux VM)"

    ```yaml
    jobs:
      build:
        machine:
          image: ubuntu-2204:current
          docker_layer_caching: true
        resource_class: medium       # 2 vCPU, 7.5 GB RAM
    ```

=== "macOS"

    ```yaml
    jobs:
      ios-build:
        macos:
          xcode: '15.4.0'
        resource_class: macos.m1.medium.gen1
        steps:
          - checkout
          - run: xcodebuild test -scheme MyApp
    ```

=== "Resource Class Reference"

    | Class | vCPU | RAM | Notes |
    |-------|------|-----|-------|
    | `small` | 1 | 2 GB | Light tasks |
    | `medium` | 2 | 4 GB | Default |
    | `medium+` | 3 | 6 GB | |
    | `large` | 4 | 8 GB | |
    | `xlarge` | 8 | 16 GB | |
    | `2xlarge` | 16 | 32 GB | Heavy builds |
    | `2xlarge+` | 20 | 40 GB | |

---

## Orbs

```yaml
version: 2.1

orbs:
  aws-ecr: circleci/aws-ecr@9
  aws-cli: circleci/aws-cli@5
  kubernetes: circleci/kubernetes@1
  helm: circleci/helm@3
  sonarcloud: sonarsource/sonarcloud@2

jobs:
  scan:
    docker:
      - image: cimg/openjdk:21.0
    steps:
      - checkout
      - sonarcloud/scan:
          sonar-token-variable-name: SONAR_TOKEN

workflows:
  main:
    jobs:
      - aws-ecr/build-and-push-image:
          name: build-image
          account-id: AWS_ACCOUNT_ID
          region: us-east-1
          repo: my-app
          tag: $CIRCLE_SHA1
          context: aws-credentials
```

---

## Caching

```yaml
jobs:
  build:
    steps:
      - checkout

      # Restore cache before installing dependencies
      - restore_cache:
          keys:
            - v2-npm-{{ checksum "package-lock.json" }}  # exact match
            - v2-npm-                                     # fallback: most recent

      - run: npm ci

      # Save after install (only when cache miss)
      - save_cache:
          key: v2-npm-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
            - node_modules/

      - run: npm run build
```

!!! tip "Cache key templates"
    | Template | Resolves to |
    |----------|------------|
    | `{{ checksum "file" }}` | MD5 of file contents |
    | `{{ epoch }}` | Unix timestamp (always unique) |
    | `{{ arch }}` | CPU architecture |
    | `{{ .Branch }}` | Current branch name |
    | `{{ .Revision }}` | Full git SHA |

---

## Workspaces (between jobs)

```yaml
jobs:
  build:
    steps:
      - checkout
      - run: npm run build
      - persist_to_workspace:
          root: .
          paths:
            - dist/
            - node_modules/

  test:
    steps:
      - attach_workspace:
          at: .
      - run: npm test

  deploy:
    steps:
      - attach_workspace:
          at: .
      - run: ./deploy.sh

workflows:
  main:
    jobs:
      - build
      - test:
          requires: [build]
      - deploy:
          requires: [test]
```

---

## Parallelism & Test Splitting

```yaml
jobs:
  test:
    parallelism: 4                  # spin up 4 containers
    docker:
      - image: cimg/ruby:3.3
    steps:
      - checkout
      - restore_cache:
          keys: [v1-gems-{{ checksum "Gemfile.lock" }}]
      - run: bundle install
      - save_cache:
          key: v1-gems-{{ checksum "Gemfile.lock" }}
          paths: [vendor/bundle]

      - run:
          name: Split and run tests
          command: |
            circleci tests glob "spec/**/*_spec.rb" | \
            circleci tests run \
              --command "bundle exec rspec" \
              --split-by=timings \
              --timings-type=filename

      - store_test_results:
          path: test-results
```

---

## Contexts & Secrets

```yaml
# Context applied to specific jobs
workflows:
  deploy:
    jobs:
      - deploy:
          context:
            - aws-production      # org-level context
            - slack-notifications  # can combine multiple

      - deploy-eu:
          context: aws-production-eu
```

**Create contexts:** *Organization Settings → Contexts → Create Context*

Restrict context access by security group. Members must be in the group to trigger jobs using that context.

```yaml
# Project-level environment variables (less preferred)
# Set in: Project Settings → Environment Variables
jobs:
  deploy:
    steps:
      - run:
          command: aws s3 sync ./dist s3://$BUCKET_NAME
          # $BUCKET_NAME comes from project env vars
```

---

## Matrix Jobs

```yaml
jobs:
  test-matrix:
    parameters:
      node-version:
        type: string
      os:
        type: string
        default: cimg/node

    docker:
      - image: << parameters.os >>:<< parameters.node-version >>
    steps:
      - checkout
      - run: npm ci && npm test

workflows:
  test-all:
    jobs:
      - test-matrix:
          matrix:
            parameters:
              node-version: ['18.20', '20.13', '22.2']
              os: ['cimg/node']
          name: test-node-<< matrix.node-version >>
```

---

## Dynamic Config

```yaml
# .circleci/config.yml — setup phase (runs first)
version: 2.1
setup: true

orbs:
  path-filtering: circleci/path-filtering@1

workflows:
  setup:
    jobs:
      - path-filtering/filter:
          base-revision: main
          config-path: .circleci/continue-config.yml
          mapping: |
            services/api/.* run-api-tests true
            services/web/.* run-web-tests true
            infra/.*        run-infra-plan true
```

```yaml
# .circleci/continue-config.yml — continuation pipeline
version: 2.1
parameters:
  run-api-tests:
    type: boolean
    default: false
  run-web-tests:
    type: boolean
    default: false

workflows:
  conditional:
    jobs:
      - test-api:
          filters:
            branches:
              only: /.*/
          pre-steps:
            - run:
                name: Skip if not triggered
                command: |
                  if [ "<< pipeline.parameters.run-api-tests >>" = "false" ]; then
                    circleci-agent step halt
                  fi
```

---

## Best Practices

| Practice | Implementation |
|----------|---------------|
| **Use Orbs** | Orbs save boilerplate; check Orb Registry before writing custom steps |
| **DLC on machine executor** | `docker_layer_caching: true` dramatically speeds up image builds |
| **Contexts over project env vars** | Org-level contexts are easier to audit and revoke |
| **Parallelism + test splitting** | Reduce test time linearly: 4x parallelism → ~4x faster |
| **Workspace for artifacts** | `persist_to_workspace` / `attach_workspace` pass build outputs cleanly |
| **Cache versioning** | Prefix keys with `v1-`, `v2-`... to force invalidation after structural changes |
| **Resource class right-sizing** | Start with `medium`; profile and downgrade where jobs idle |
| **Approval jobs for production** | `type: approval` creates manual gates before sensitive deployments |
| **Dynamic config for monorepos** | Path filtering with `setup: true` skips unaffected services |
| **`store_test_results`** | Enables Insights timing-based test splitting and failure tracking |

[← Azure DevOps](azure-devops.md) | [← CI/CD Overview](index.md)
