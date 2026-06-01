---
title: CircleCI
description: Referência de orbs, workflows, cache, classes de recurso, Docker Layer Caching, contextos e paralelismo do CircleCI.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / circle-ci</span>
    <h1 class="dph-title">CircleCI</h1>
    <p class="dph-desc">CI/CD rápido e nativo em nuvem, otimizado para a velocidade do desenvolvedor. Orbs para integrações instantâneas, divisão inteligente de testes para paralelismo, Docker Layer Caching para builds mais rápidos e Contextos para gerenciamento seguro de secrets em toda a organização.</p>
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

## Anatomia da Configuração

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
      docker_layer_caching: true      # DLC — reutiliza o cache de camadas Docker
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
            - aws-production            # contexto organizacional com credenciais AWS
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
          type: approval              # gate manual
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

## Conceitos Principais

| Conceito | Descrição |
|---------|-------------|
| **Job** | Conjunto nomeado de passos executados em um executor |
| **Passo** | Um comando `run`, passo integrado ou comando de orb |
| **Executor** | Ambiente de execução: Docker, machine, macOS, Windows |
| **Workflow** | DAG de jobs — define ordenação, condições e aprovações |
| **Orb** | Pacote reutilizável de jobs, comandos e executores (semelhante a uma action) |
| **Contexto** | Armazenamento de secrets no nível da organização ou do projeto, aplicado a jobs |
| **Cache** | Cache de dependências persistido entre execuções do pipeline |
| **Workspace** | Dados efêmeros transferidos entre jobs no mesmo workflow |
| **Classe de recurso** | Nível de CPU/RAM do executor |
| **DLC** | Docker Layer Caching — acelera `docker build` entre execuções |

---

## Executores e Classes de Recurso

=== "Docker"

    ```yaml
    executors:
      small-node:
        docker:
          - image: cimg/node:20.13   # imagem de conveniência do CircleCI
          - image: postgres:16       # container de serviço
            environment:
              POSTGRES_PASSWORD: test
        resource_class: small        # 1 vCPU, 2 GB RAM
    ```

=== "Machine (VM Linux)"

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

=== "Referência de Classes de Recurso"

    | Classe | vCPU | RAM | Observações |
    |-------|------|-----|-------|
    | `small` | 1 | 2 GB | Tarefas leves |
    | `medium` | 2 | 4 GB | Padrão |
    | `medium+` | 3 | 6 GB | |
    | `large` | 4 | 8 GB | |
    | `xlarge` | 8 | 16 GB | |
    | `2xlarge` | 16 | 32 GB | Builds pesados |
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

## Cache

```yaml
jobs:
  build:
    steps:
      - checkout

      # Restaurar cache antes de instalar dependências
      - restore_cache:
          keys:
            - v2-npm-{{ checksum "package-lock.json" }}  # correspondência exata
            - v2-npm-                                     # fallback: o mais recente

      - run: npm ci

      # Salvar após a instalação (apenas em caso de cache miss)
      - save_cache:
          key: v2-npm-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
            - node_modules/

      - run: npm run build
```

!!! tip "Templates de chave de cache"
    | Template | Resolve para |
    |----------|------------|
    | `{{ checksum "file" }}` | MD5 do conteúdo do arquivo |
    | `{{ epoch }}` | Timestamp Unix (sempre único) |
    | `{{ arch }}` | Arquitetura da CPU |
    | `{{ .Branch }}` | Nome da branch atual |
    | `{{ .Revision }}` | SHA completo do git |

---

## Workspaces (entre Jobs)

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

## Paralelismo e Divisão de Testes

```yaml
jobs:
  test:
    parallelism: 4                  # inicializa 4 containers
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
          name: Dividir e executar testes
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

## Contextos e Secrets

```yaml
# Contexto aplicado a jobs específicos
workflows:
  deploy:
    jobs:
      - deploy:
          context:
            - aws-production      # contexto organizacional
            - slack-notifications  # é possível combinar múltiplos

      - deploy-eu:
          context: aws-production-eu
```

**Criar contextos:** *Organization Settings → Contexts → Create Context*

Restrinja o acesso ao contexto por grupo de segurança. Os membros precisam estar no grupo para acionar jobs que usam aquele contexto.

```yaml
# Variáveis de ambiente no nível do projeto (menos recomendado)
# Configurar em: Project Settings → Environment Variables
jobs:
  deploy:
    steps:
      - run:
          command: aws s3 sync ./dist s3://$BUCKET_NAME
          # $BUCKET_NAME vem das variáveis de ambiente do projeto
```

---

## Jobs em Matriz

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

## Configuração Dinâmica

```yaml
# .circleci/config.yml — fase de setup (executada primeiro)
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
# .circleci/continue-config.yml — pipeline de continuação
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
                name: Ignorar se não acionado
                command: |
                  if [ "<< pipeline.parameters.run-api-tests >>" = "false" ]; then
                    circleci-agent step halt
                  fi
```

---

## Boas Práticas

| Prática | Implementação |
|----------|---------------|
| **Use Orbs** | Orbs eliminam boilerplate; consulte o Orb Registry antes de criar passos customizados |
| **DLC no executor machine** | `docker_layer_caching: true` acelera significativamente os builds de imagem |
| **Contextos em vez de variáveis de projeto** | Contextos organizacionais são mais fáceis de auditar e revogar |
| **Paralelismo + divisão de testes** | Reduza o tempo de teste linearmente: 4x paralelismo → ~4x mais rápido |
| **Workspace para artefatos** | `persist_to_workspace` / `attach_workspace` transferem saídas de build de forma limpa |
| **Versionamento de cache** | Prefixe chaves com `v1-`, `v2-`... para forçar a invalidação após mudanças estruturais |
| **Dimensionamento da classe de recurso** | Comece com `medium`; faça profiling e reduza onde jobs ficam ociosos |
| **Jobs de aprovação para produção** | `type: approval` cria gates manuais antes de implantações sensíveis |
| **Configuração dinâmica para monorepos** | Filtragem por caminho com `setup: true` ignora serviços não afetados |
| **`store_test_results`** | Habilita a divisão de testes baseada em tempo pelo Insights e rastreamento de falhas |

[← Azure DevOps](azure-devops.md) | [← CI/CD Overview](index.md)
