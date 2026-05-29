---
title: Azure DevOps
description: Azure DevOps YAML pipelines, stages, service connections, environments, variable groups and Artifacts reference.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / azure-devops</span>
    <h1 class="dph-title">Azure DevOps</h1>
    <p class="dph-desc">Microsoft's end-to-end DevOps platform. YAML multi-stage pipelines with gates and approvals, Azure Artifacts for package management, Environments for deployment tracking with rollback, and deep integration with Azure services through service connections.</p>
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

## Pipeline Anatomy

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

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Stage** | Top-level grouping — appears in the pipeline visualization |
| **Job** | Set of steps on a single agent. Jobs in a stage run in parallel by default |
| **Deployment Job** | Special job targeting an Environment — tracks deployment history |
| **Step** | A task or script within a job |
| **Task** | Pre-built unit of work (marketplace or built-in) |
| **Agent** | Host running jobs: Microsoft-hosted (pay-per-minute) or self-hosted |
| **Agent Pool** | Group of agents. Projects get access to pools via org settings |
| **Service Connection** | Authenticated connection to external services (ACR, AKS, GitHub…) |
| **Environment** | Named deployment target with history, approvals and resource checks |
| **Variable Group** | Shared set of variables (with optional Key Vault linkage) |
| **Artifact** | Build output published with `PublishBuildArtifacts@1` or Pipeline Artifacts |

---

## Variables & Variable Groups

=== "Inline Variables"

    ```yaml
    variables:
      buildConfiguration: Release
      major: 1
      minor: 0
      patch: $(Build.BuildId)
      semver: $(major).$(minor).$(patch)
    ```

=== "Variable Group"

    ```yaml
    variables:
      - group: production-secrets     # Links to Key Vault or manually-defined secrets
      - name: localVar
        value: something
    ```

    Create groups under **Pipelines → Library → Variable Groups**. For Key Vault-backed groups, set `Link secrets from an Azure Key Vault`.

=== "Runtime Parameters"

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

## Service Connections

| Connection Type | Purpose |
|----------------|---------|
| **Azure Resource Manager** | ARM/AKS operations (managed identity or SP) |
| **Docker Registry** | Push/pull from ACR, Docker Hub, GCR |
| **Kubernetes** | Deploy to AKS or any cluster (kubeconfig / SA) |
| **GitHub** | Source checkout, GitHub checks, PR status |
| **Bitbucket Cloud** | Source checkout |
| **SSH** | SSH-based deployments |
| **Generic** | Arbitrary HTTP endpoint with token auth |

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

## Environments & Approvals

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

**Configure approvals:** *Environments → production → Approvals and checks → Approvals*

Check types available:
- Required reviewers (person or group)
- Branch control (only from protected branch)
- Business hours gate
- Invoke Azure Function / REST API

---

## Templates

=== "Step Template"

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

=== "Stage Template"

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

=== "Pipeline Template"

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

## Self-Hosted Agents

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

## Useful Built-in Variables

| Variable | Value |
|----------|-------|
| `$(Build.BuildId)` | Unique build number (auto-incrementing) |
| `$(Build.BuildNumber)` | Formatted build number |
| `$(Build.SourceVersion)` | Full commit SHA |
| `$(Build.SourceBranch)` | `refs/heads/main` |
| `$(Build.SourceBranchName)` | `main` |
| `$(Build.Repository.Name)` | Repository name |
| `$(Build.ArtifactStagingDirectory)` | Temp dir for artifacts |
| `$(System.DefaultWorkingDirectory)` | Source checkout root |
| `$(System.TeamProject)` | Project name |
| `$(Agent.OS)` | `Linux`, `Darwin`, `Windows_NT` |
| `$(Pipeline.Workspace)` | Root of the pipeline workspace |

---

## Best Practices

| Practice | Implementation |
|----------|---------------|
| **Multi-stage YAML** | All pipelines in version-controlled YAML — no classic editor |
| **Templates** | Centralise DRY logic in a shared `pipeline-templates` repo |
| **Environments for deployments** | Use deployment jobs — enables history, rollback and approvals |
| **Key Vault-backed variable groups** | Link secrets directly from Azure Key Vault; never store in DevOps |
| **Service connections with managed identity** | Prefer workload identity federation over service principal passwords |
| **Agent pool sizing** | Use KEDA autoscaler for self-hosted agents to control costs |
| **Branch policies** | Require pipeline pass + reviewer approval before merge to main |
| **`condition:` expressions** | Guard stages with `succeeded()`, branch checks, parameter flags |
| **Artifact retention** | Set pipeline-level retention policies; don't keep artifacts forever |
| **Audit log** | Enable Azure DevOps Auditing — tracks credential and permission changes |

[← Tekton](tekton.md) | [← CI/CD Overview](index.md) | [CircleCI →](circle-ci.md)
