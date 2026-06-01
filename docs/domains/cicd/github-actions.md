---
title: GitHub Actions
description: Workflows, runners, matrix builds, OIDC, workflows reutilizáveis e referência de ambientes do GitHub Actions.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / github-actions</span>
    <h1 class="dph-title">GitHub Actions</h1>
    <p class="dph-desc">Plataforma nativa de CI/CD do GitHub. Workflows orientados a eventos definidos como YAML que vivem junto ao seu código. Vasto marketplace de actions da comunidade, OIDC integrado para autenticação em nuvem sem senha e suporte de primeira classe para matrix builds, workflows reutilizáveis e ambientes de implantação.</p>
    <div class="dph-badges">
      <span class="tech-badge">Workflows</span>
      <span class="tech-badge">Runners</span>
      <span class="tech-badge">OIDC</span>
      <span class="tech-badge">Matrix</span>
      <span class="tech-badge">Reusable Workflows</span>
      <span class="tech-badge">Environments</span>
    </div>
  </div>
</div>

[← Visão Geral de CI/CD](index.md) | [GitLab CI →](gitlab-ci.md)

---

## Anatomia do Workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:          # manual trigger

permissions:
  contents: read
  id-token: write             # required for OIDC

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.22"
          cache: true

      - name: Build
        run: go build ./...

      - name: Test
        run: go test -race -coverprofile=coverage.out ./...

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage.out
```

---

## Conceitos Principais

| Conceito | Descrição |
|---------|-------------|
| **Workflow** | Arquivo YAML em `.github/workflows/` — unidade de automação de nível superior |
| **Event** | Gatilho: `push`, `pull_request`, `schedule`, `workflow_dispatch`, `release`… |
| **Job** | Conjunto de passos executados no mesmo runner. Jobs rodam em paralelo por padrão |
| **Step** | Unidade atômica — `run` (shell) ou `uses` (action) |
| **Action** | Unidade reutilizável: JavaScript, container Docker ou composta |
| **Runner** | Host que executa os jobs. Hospedado pelo GitHub (Ubuntu/Windows/macOS) ou self-hosted |
| **Context** | Objetos integrados: `github`, `env`, `vars`, `secrets`, `inputs`, `steps`, `jobs` |
| **Expression** | `${{ ... }}` — avaliado pelo runner, suporta funções e operadores |

---

## Referência de Gatilhos

```yaml
on:
  push:
    branches: [main]
    paths-ignore: ['**.md', 'docs/**']
    tags: ['v*']

  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main, 'release/**']

  schedule:
    - cron: '0 6 * * 1-5'     # Mon–Fri at 06:00 UTC

  workflow_call:               # called by another workflow
    inputs:
      environment:
        type: string
        required: true
    secrets:
      token:
        required: true

  workflow_dispatch:
    inputs:
      version:
        description: Release version
        required: true
        default: patch
        type: choice
        options: [patch, minor, major]
```

---

## Matrix Builds

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, macos-14, windows-2022]
        node: ['18', '20', '22']
        exclude:
          - os: windows-2022
            node: '18'
        include:
          - os: ubuntu-24.04
            node: '22'
            experimental: true

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci && npm test
```

---

## Cache

```yaml
steps:
  - uses: actions/checkout@v4

  # --- Node.js ---
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
      cache: npm              # built-in cache in setup-* actions

  # --- Manual cache ---
  - name: Cache Gradle
    uses: actions/cache@v4
    with:
      path: |
        ~/.gradle/caches
        ~/.gradle/wrapper
      key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*') }}
      restore-keys: ${{ runner.os }}-gradle-
```

---

## OIDC — Autenticação em Nuvem Sem Senha

=== "AWS"

    ```yaml
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      - run: aws sts get-caller-identity
    ```

=== "GCP"

    ```yaml
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
          service_account: deploy@my-project.iam.gserviceaccount.com

      - uses: google-github-actions/setup-gcloud@v2
    ```

=== "Azure"

    ```yaml
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - run: az account show
    ```

---

## Workflows Reutilizáveis

=== "Chamador"

    ```yaml
    # .github/workflows/deploy.yml
    jobs:
      deploy-staging:
        uses: my-org/shared-workflows/.github/workflows/deploy.yml@main
        with:
          environment: staging
          image-tag: ${{ needs.build.outputs.image-tag }}
        secrets:
          kubeconfig: ${{ secrets.STAGING_KUBECONFIG }}

      deploy-prod:
        needs: deploy-staging
        uses: my-org/shared-workflows/.github/workflows/deploy.yml@main
        with:
          environment: production
          image-tag: ${{ needs.build.outputs.image-tag }}
        secrets: inherit
    ```

=== "Workflow Chamado"

    ```yaml
    # .github/workflows/deploy.yml (in shared-workflows repo)
    on:
      workflow_call:
        inputs:
          environment:
            type: string
            required: true
          image-tag:
            type: string
            required: true
        secrets:
          kubeconfig:
            required: true

    jobs:
      deploy:
        runs-on: ubuntu-24.04
        environment: ${{ inputs.environment }}
        steps:
          - name: Deploy
            run: |
              echo "${{ secrets.kubeconfig }}" > kubeconfig.yaml
              kubectl --kubeconfig kubeconfig.yaml set image deployment/app app=${{ inputs.image-tag }}
    ```

---

## Actions Compostas

```yaml
# .github/actions/setup-terraform/action.yml
name: Setup Terraform
description: Install Terraform + authenticate to cloud

inputs:
  terraform-version:
    description: Terraform version
    default: '1.8.0'
  aws-role-arn:
    description: IAM role ARN for OIDC
    required: true

outputs:
  terraform-version:
    description: Installed version
    value: ${{ steps.tf.outputs.terraform_version }}

runs:
  using: composite
  steps:
    - uses: hashicorp/setup-terraform@v3
      id: tf
      with:
        terraform_version: ${{ inputs.terraform-version }}

    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: ${{ inputs.aws-role-arn }}
        aws-region: us-east-1
```

---

## Ambientes de Implantação

```yaml
jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment:
      name: production
      url: https://app.example.com    # shown in PR/Actions UI

    steps:
      - name: Deploy to production
        run: ./scripts/deploy.sh
        env:
          API_KEY: ${{ secrets.PROD_API_KEY }}  # env-scoped secret
          APP_URL: ${{ vars.PROD_APP_URL }}      # env-scoped variable
```

!!! tip "Regras de proteção"
    Ambientes suportam revisores obrigatórios, temporizadores de espera e políticas de branch/tag.
    Configure em **Configurações → Ambientes** no seu repositório.

---

## Serviços de Container e Docker

```yaml
jobs:
  integration-test:
    runs-on: ubuntu-24.04

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4
      - name: Run integration tests
        run: pytest tests/integration/
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/testdb
          REDIS_URL: redis://localhost:6379
```

---

## Build e Push de Imagem de Container

```yaml
jobs:
  build-push:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,prefix=sha-
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}

      - uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

---

## Dependências e Saídas de Jobs

```yaml
jobs:
  build:
    runs-on: ubuntu-24.04
    outputs:
      image-tag: ${{ steps.tag.outputs.value }}
    steps:
      - id: tag
        run: echo "value=sha-${{ github.sha }}" >> $GITHUB_OUTPUT

  test:
    needs: build
    runs-on: ubuntu-24.04
    steps:
      - run: echo "Image tag is ${{ needs.build.outputs.image-tag }}"

  deploy:
    needs: [build, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.image-tag }}"
```

---

## Boas Práticas de Segurança

| Prática | Implementação |
|----------|---------------|
| **Fixar actions em SHAs** | `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` e não `@v4` |
| **Permissões mínimas** | Declare `permissions:` no nível do job, conceda apenas o necessário |
| **OIDC em vez de segredos de longa duração** | Use Workload Identity Federation — sem credenciais de nuvem armazenadas |
| **Varredura de segredos** | Ative o GitHub Secret Scanning + proteção de push nas configurações do repositório |
| **Revisão de dependências** | `actions/dependency-review-action` em cada PR |
| **Segurança de passos** | `GITHUB_TOKEN` expira automaticamente por execução; nunca use `echo` em segredos |
| **Actions de terceiros** | Audite actions do marketplace; prefira criadores verificados ou da organização |
| **Proteção de ambientes** | Exija revisores para ambientes de produção |

---

## Cheatsheet de Actions

| Tarefa | Action |
|------|--------|
| Checkout | `actions/checkout@v4` |
| Node.js | `actions/setup-node@v4` |
| Python | `actions/setup-python@v5` |
| Go | `actions/setup-go@v5` |
| Java | `actions/setup-java@v4` |
| Docker Buildx | `docker/setup-buildx-action@v3` |
| Docker login | `docker/login-action@v3` |
| Docker build & push | `docker/build-push-action@v5` |
| AWS OIDC | `aws-actions/configure-aws-credentials@v4` |
| GCP OIDC | `google-github-actions/auth@v2` |
| Azure login | `azure/login@v2` |
| kubectl | `azure/setup-kubectl@v4` ou `google-github-actions/setup-gcloud@v2` |
| Helm | `azure/setup-helm@v4` |
| Terraform | `hashicorp/setup-terraform@v3` |
| Upload de artefato | `actions/upload-artifact@v4` |
| Download de artefato | `actions/download-artifact@v4` |
| Cache | `actions/cache@v4` |
| Notificação Slack | `slackapi/slack-github-action@v2` |

[← Visão Geral de CI/CD](index.md) | [GitLab CI →](gitlab-ci.md)
