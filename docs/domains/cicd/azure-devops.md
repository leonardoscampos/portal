---
title: Azure DevOps
description: Referência de pipelines YAML, estágios, conexões de serviço, ambientes, grupos de variáveis e Artifacts do Azure DevOps.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / azure-devops</span>
    <h1 class="dph-title">Azure DevOps</h1>
    <p class="dph-desc">Plataforma DevOps end-to-end da Microsoft. Pipelines YAML multi-estágio com gates e aprovações, Azure Artifacts para gerenciamento de pacotes, Ambientes para rastreamento de implantações com rollback e integração profunda com serviços Azure por meio de conexões de serviço.</p>
    <div class="dph-badges">
      <span class="tech-badge">YAML Pipelines</span>
      <span class="tech-badge">Stages</span>
      <span class="tech-badge">Service Connections</span>
      <span class="tech-badge">Environments</span>
      <span class="tech-badge">Variable Groups</span>
      <span class="tech-badge">Artifacts</span>
    </div>
  </div>
</div>

[← Tekton](tekton.md) | [← CI/CD Overview](index.md) | [CircleCI →](circle-ci.md)

---

## Anatomia do Pipeline

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include: [main, release/*]
  paths:
    exclude: ['**.md', 'docs/**']

pr:
  branches:
    include: [main]

variables:
  - group: shared-variables         # variable group from Azure DevOps library
  - name: imageRepository
    value: my-app
  - name: containerRegistry
    value: myacr.azurecr.io
  - name: tag
    value: $(Build.SourceVersion)

pool:
  vmImage: ubuntu-latest            # Microsoft-hosted agent

stages:
  - stage: Build
    displayName: Build & Test
    jobs:
      - job: BuildJob
        steps:
          - task: UseDotNet@2
            inputs:
              version: '8.x'

          - script: dotnet build --configuration Release
            displayName: Build

          - task: DotNetCoreCLI@2
            displayName: Test
            inputs:
              command: test
              arguments: '--collect:"XPlat Code Coverage"'

          - task: PublishCodeCoverageResults@2
            inputs:
              summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'

  - stage: Docker
    displayName: Build & Push Image
    dependsOn: Build
    condition: succeeded()
    jobs:
      - job: DockerJob
        steps:
          - task: Docker@2
            displayName: Build and push image
            inputs:
              command: buildAndPush
              repository: $(imageRepository)
              dockerfile: Dockerfile
              containerRegistry: acr-service-connection
              tags: |
                $(tag)
                latest

  - stage: DeployStaging
    displayName: Deploy to Staging
    dependsOn: Docker
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: DeployStaging
        environment: staging           # Azure DevOps Environment
        strategy:
          runOnce:
            deploy:
              steps:
                - task: HelmDeploy@0
                  inputs:
                    command: upgrade
                    chartName: ./helm
                    releaseName: my-app-staging
                    valueFile: values-staging.yaml
                    overrideValues: image.tag=$(tag)

  - stage: DeployProd
    displayName: Deploy to Production
    dependsOn: DeployStaging
    condition: succeeded()
    jobs:
      - deployment: DeployProd
        environment: production         # has approval gate configured
        strategy:
          runOnce:
            deploy:
              steps:
                - task: HelmDeploy@0
                  inputs:
                    command: upgrade
                    chartName: ./helm
                    releaseName: my-app
                    valueFile: values-prod.yaml
                    overrideValues: image.tag=$(tag)
```

---

## Conceitos Principais

| Conceito | Descrição |
|---------|-------------|
| **Estágio** | Agrupamento de nível superior — aparece na visualização do pipeline |
| **Job** | Conjunto de passos em um único agente. Jobs em um estágio são executados em paralelo por padrão |
| **Deployment Job** | Job especial que referencia um Ambiente — rastreia o histórico de implantações |
| **Passo** | Uma tarefa ou script dentro de um job |
| **Tarefa** | Unidade de trabalho pré-construída (marketplace ou integrada) |
| **Agente** | Host que executa jobs: hospedado pela Microsoft (pago por minuto) ou auto-hospedado |
| **Pool de Agentes** | Grupo de agentes. Projetos obtêm acesso a pools pelas configurações da organização |
| **Conexão de Serviço** | Conexão autenticada para serviços externos (ACR, AKS, GitHub…) |
| **Ambiente** | Alvo de implantação nomeado com histórico, aprovações e verificações de recursos |
| **Grupo de Variáveis** | Conjunto compartilhado de variáveis (com vínculo opcional ao Key Vault) |
| **Artefato** | Saída de build publicada com `PublishBuildArtifacts@1` ou Pipeline Artifacts |

---

## Variáveis e Grupos de Variáveis

=== "Variáveis Inline"

    ```yaml
    variables:
      buildConfiguration: Release
      major: 1
      minor: 0
      patch: $(Build.BuildId)
      semver: $(major).$(minor).$(patch)
    ```

=== "Grupo de Variáveis"

    ```yaml
    variables:
      - group: production-secrets     # Links to Key Vault or manually-defined secrets
      - name: localVar
        value: something
    ```

    Crie grupos em **Pipelines → Library → Variable Groups**. Para grupos vinculados ao Key Vault, defina `Link secrets from an Azure Key Vault`.

=== "Parâmetros de Execução"

    ```yaml
    parameters:
      - name: environment
        displayName: Target environment
        type: string
        default: staging
        values: [staging, production]

      - name: runTests
        displayName: Run tests?
        type: boolean
        default: true

    stages:
      - stage: Deploy
        condition: eq('${{ parameters.environment }}', 'production')
    ```

---

## Conexões de Serviço

| Tipo de Conexão | Finalidade |
|----------------|---------|
| **Azure Resource Manager** | Operações ARM/AKS (identidade gerenciada ou SP) |
| **Docker Registry** | Push/pull de ACR, Docker Hub, GCR |
| **Kubernetes** | Implantação no AKS ou qualquer cluster (kubeconfig / SA) |
| **GitHub** | Checkout de código, checks do GitHub, status de PR |
| **Bitbucket Cloud** | Checkout de código |
| **SSH** | Implantações via SSH |
| **Generic** | Endpoint HTTP arbitrário com autenticação por token |

```yaml
# Using a service connection in a task
- task: AzureCLI@2
  inputs:
    azureSubscription: my-azure-service-connection   # service connection name
    scriptType: bash
    scriptLocation: inlineScript
    inlineScript: |
      az aks get-credentials --resource-group rg-prod --name aks-prod
      kubectl get pods
```

---

## Ambientes e Aprovações

```yaml
jobs:
  - deployment: DeployProduction
    environment:
      name: production
      resourceName: my-kubernetes-resource   # optional K8s resource for pod-level tracking
    strategy:
      runOnce:
        deploy:
          steps:
            - script: echo "Deploying to production"
```

**Configurar aprovações:** *Environments → production → Approvals and checks → Approvals*

Tipos de verificação disponíveis:
- Revisores obrigatórios (pessoa ou grupo)
- Controle de branch (somente de branch protegida)
- Gate de horário comercial
- Invocar Azure Function / REST API

---

## Templates

=== "Template de Passo"

    ```yaml
    # templates/steps/build-and-test.yml
    parameters:
      - name: dotnetVersion
        type: string
        default: '8.x'

    steps:
      - task: UseDotNet@2
        inputs:
          version: ${{ parameters.dotnetVersion }}

      - script: dotnet build --configuration Release
        displayName: Build

      - task: DotNetCoreCLI@2
        displayName: Test
        inputs:
          command: test
    ```

    ```yaml
    # azure-pipelines.yml — consuming the template
    stages:
      - stage: Build
        jobs:
          - job: Build
            steps:
              - template: templates/steps/build-and-test.yml
                parameters:
                  dotnetVersion: '8.x'
    ```

=== "Template de Estágio"

    ```yaml
    # templates/stages/deploy.yml
    parameters:
      - name: environment
        type: string
      - name: imageTag
        type: string

    stages:
      - stage: Deploy_${{ parameters.environment }}
        jobs:
          - deployment: Deploy
            environment: ${{ parameters.environment }}
            strategy:
              runOnce:
                deploy:
                  steps:
                    - script: |
                        helm upgrade --install app ./helm \
                          --set image.tag=${{ parameters.imageTag }}
    ```

=== "Template de Pipeline"

    ```yaml
    # azure-pipelines.yml
    trigger: [main]

    extends:
      template: templates/pipelines/standard-pipeline.yml@templates
      parameters:
        appName: my-app
        registry: myacr.azurecr.io

    resources:
      repositories:
        - repository: templates
          type: git
          name: my-org/pipeline-templates
          ref: refs/heads/main
    ```

---

## Azure Artifacts

```yaml
# Publish NuGet package to Azure Artifacts feed
- task: DotNetCoreCLI@2
  displayName: Pack
  inputs:
    command: pack
    packagesToPack: '**/*.csproj'
    versioningScheme: byBuildNumber

- task: NuGetCommand@2
  displayName: Push to feed
  inputs:
    command: push
    packagesToPush: '$(Build.ArtifactStagingDirectory)/**/*.nupkg'
    nuGetFeedType: internal
    publishVstsFeed: my-feed

# npm packages
- task: Npm@1
  displayName: Publish npm package
  inputs:
    command: publish
    publishRegistry: useFeed
    publishFeed: my-org/my-feed
```

---

## Agentes Auto-hospedados

=== "Docker"

    ```bash
    docker run -d \
      -e AZP_URL=https://dev.azure.com/my-org \
      -e AZP_TOKEN=<PAT> \
      -e AZP_POOL=Default \
      -e AZP_AGENT_NAME=docker-agent \
      --name azure-agent \
      mcr.microsoft.com/azure-pipelines/vsts-agent:ubuntu-22.04
    ```

=== "Kubernetes (KEDA)"

    ```yaml
    # Autoscale Azure DevOps agent pool using KEDA
    apiVersion: keda.sh/v1alpha1
    kind: ScaledJob
    metadata:
      name: azdevops-agent
    spec:
      jobTargetRef:
        template:
          spec:
            containers:
              - name: agent
                image: mcr.microsoft.com/azure-pipelines/vsts-agent:ubuntu-22.04
                env:
                  - name: AZP_URL
                    value: https://dev.azure.com/my-org
                  - name: AZP_TOKEN
                    valueFrom:
                      secretKeyRef:
                        name: azdevops-secret
                        key: token
                  - name: AZP_POOL
                    value: kubernetes-pool
      triggers:
        - type: azure-pipelines
          metadata:
            organizationURLFromEnv: AZP_URL
            tokenFromEnv: AZP_TOKEN
            poolName: kubernetes-pool
    ```

---

## Variáveis Integradas Úteis

| Variável | Valor |
|----------|-------|
| `$(Build.BuildId)` | Número de build único (auto-incremental) |
| `$(Build.BuildNumber)` | Número de build formatado |
| `$(Build.SourceVersion)` | SHA completo do commit |
| `$(Build.SourceBranch)` | `refs/heads/main` |
| `$(Build.SourceBranchName)` | `main` |
| `$(Build.Repository.Name)` | Nome do repositório |
| `$(Build.ArtifactStagingDirectory)` | Diretório temporário para artefatos |
| `$(System.DefaultWorkingDirectory)` | Raiz do checkout do código-fonte |
| `$(System.TeamProject)` | Nome do projeto |
| `$(Agent.OS)` | `Linux`, `Darwin`, `Windows_NT` |
| `$(Pipeline.Workspace)` | Raiz do workspace do pipeline |

---

## Boas Práticas

| Prática | Implementação |
|----------|---------------|
| **YAML Multi-estágio** | Todos os pipelines em YAML com controle de versão — sem editor clássico |
| **Templates** | Centralize lógica DRY em um repositório compartilhado `pipeline-templates` |
| **Ambientes para implantações** | Use deployment jobs — habilita histórico, rollback e aprovações |
| **Grupos de variáveis com Key Vault** | Vincule secrets diretamente do Azure Key Vault; nunca armazene no DevOps |
| **Conexões de serviço com identidade gerenciada** | Prefira federação de identidade de carga de trabalho em vez de senhas de service principal |
| **Dimensionamento do pool de agentes** | Use o autoscaler KEDA para agentes auto-hospedados para controlar custos |
| **Políticas de branch** | Exija aprovação do pipeline e de revisor antes do merge para main |
| **Expressões `condition:`** | Proteja estágios com `succeeded()`, verificações de branch, flags de parâmetros |
| **Retenção de artefatos** | Defina políticas de retenção no nível do pipeline; não mantenha artefatos para sempre |
| **Log de auditoria** | Habilite o Azure DevOps Auditing — rastreia mudanças de credenciais e permissões |

[← Tekton](tekton.md) | [← CI/CD Overview](index.md) | [CircleCI →](circle-ci.md)
