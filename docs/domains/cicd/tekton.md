---
title: Tekton
description: Referência de CI/CD nativo do Kubernetes com Tekton: Tasks, Pipelines, Triggers e segurança da cadeia de suprimentos com Tekton Chains.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / tekton</span>
    <h1 class="dph-title">Tekton</h1>
    <p class="dph-desc">Framework de CI/CD nativo do Kubernetes construído sobre CRDs. Tasks, Pipelines e Triggers são executados como workloads regulares do Kubernetes — escaláveis, portáteis e totalmente declarativos. Tekton Chains adiciona segurança automática da cadeia de suprimentos com proveniência SLSA e assinatura Sigstore.</p>
    <div class="dph-badges">
      <span class="tech-badge">Tasks</span>
      <span class="tech-badge">Pipelines</span>
      <span class="tech-badge">Triggers</span>
      <span class="tech-badge">Tekton Chains</span>
      <span class="tech-badge">Dashboard</span>
      <span class="tech-badge">SLSA</span>
    </div>
  </div>
</div>

[← Jenkins](jenkins.md) | [← Visão Geral de CI/CD](index.md) | [Azure DevOps →](azure-devops.md)

---

## Visão Geral dos CRDs Principais

| CRD | Descrição |
|-----|-------------|
| **Task** | Lista ordenada de Passos. Cada Passo é um contêiner. A unidade de reuso |
| **TaskRun** | Instanciação de uma Task com parâmetros e workspaces |
| **Pipeline** | DAG de Tasks com parâmetros, workspaces e conexão de resultados |
| **PipelineRun** | Instanciação de um Pipeline |
| **Workspace** | Volume compartilhado entre Tasks (PVC, ConfigMap, Segredo, emptyDir) |
| **Param** | Entrada tipada (string, array, objeto) |
| **Result** | Saída de string emitida por uma Task, consumida por Tasks downstream |
| **StepAction** | Passo único reutilizável (Tekton v0.54+, compatível com Tekton Hub) |

---

## Instalando o Tekton

```bash
# Pipelines
kubectl apply -f https://storage.googleapis.com/tekton-releases/pipeline/latest/release.yaml

# Triggers
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/latest/release.yaml
kubectl apply -f https://storage.googleapis.com/tekton-releases/triggers/latest/interceptors.yaml

# Dashboard
kubectl apply -f https://storage.googleapis.com/tekton-releases/dashboard/latest/release.yaml

# Tekton CLI
brew install tektoncd-cli
```

---

## Task

```yaml
apiVersion: tekton.dev/v1
kind: Task
metadata:
  name: build-push-image
spec:
  params:
    - name: image
      type: string
      description: Full image ref (registry/repo:tag)
    - name: context
      type: string
      default: "."

  workspaces:
    - name: source
      description: Checked-out source code

  results:
    - name: image-digest
      description: SHA256 digest of the pushed image

  steps:
    - name: build
      image: gcr.io/kaniko-project/executor:v1.23.2
      args:
        - --context=$(workspaces.source.path)/$(params.context)
        - --destination=$(params.image)
        - --digest-file=$(results.image-digest.path)
      env:
        - name: DOCKER_CONFIG
          value: /kaniko/.docker
      volumeMounts:
        - name: docker-config
          mountPath: /kaniko/.docker

  volumes:
    - name: docker-config
      secret:
        secretName: docker-registry-credentials
        items:
          - key: .dockerconfigjson
            path: config.json
```

---

## Pipeline

```yaml
apiVersion: tekton.dev/v1
kind: Pipeline
metadata:
  name: build-test-deploy
spec:
  params:
    - name: repo-url
      type: string
    - name: revision
      type: string
      default: main
    - name: image-name
      type: string

  workspaces:
    - name: shared-data          # passed to all tasks
    - name: git-credentials

  results:
    - name: image-digest
      value: $(tasks.build.results.image-digest)

  tasks:
    - name: clone
      taskRef:
        resolver: hub
        params:
          - name: catalog
            value: tekton-catalog-tasks
          - name: type
            value: artifact
          - name: kind
            value: task
          - name: name
            value: git-clone
          - name: version
            value: "0.9"
      params:
        - name: url
          value: $(params.repo-url)
        - name: revision
          value: $(params.revision)
      workspaces:
        - name: output
          workspace: shared-data
        - name: ssh-directory
          workspace: git-credentials

    - name: test
      runAfter: [clone]
      taskRef:
        name: run-tests           # local Task
      workspaces:
        - name: source
          workspace: shared-data

    - name: build
      runAfter: [test]
      taskRef:
        name: build-push-image
      params:
        - name: image
          value: $(params.image-name):$(tasks.clone.results.commit)
      workspaces:
        - name: source
          workspace: shared-data

    - name: deploy
      runAfter: [build]
      taskRef:
        name: helm-upgrade-from-repo
      params:
        - name: image-tag
          value: $(tasks.clone.results.commit)
        - name: image-digest
          value: $(tasks.build.results.image-digest)
```

---

## PipelineRun

```yaml
apiVersion: tekton.dev/v1
kind: PipelineRun
metadata:
  generateName: build-test-deploy-
spec:
  pipelineRef:
    name: build-test-deploy

  params:
    - name: repo-url
      value: https://github.com/my-org/my-app
    - name: revision
      value: main
    - name: image-name
      value: ghcr.io/my-org/my-app

  workspaces:
    - name: shared-data
      volumeClaimTemplate:
        spec:
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 1Gi

    - name: git-credentials
      secret:
        secretName: git-ssh-credentials

  taskRunTemplate:
    podTemplate:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
```

---

## Gatilhos (Webhook → PipelineRun)

```yaml
# TriggerBinding — extracts values from the webhook payload
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerBinding
metadata:
  name: github-push-binding
spec:
  params:
    - name: repo-url
      value: $(body.repository.clone_url)
    - name: revision
      value: $(body.after)
    - name: image-name
      value: ghcr.io/my-org/$(body.repository.name)

---
# TriggerTemplate — creates resources on event
apiVersion: triggers.tekton.dev/v1beta1
kind: TriggerTemplate
metadata:
  name: build-deploy-template
spec:
  params:
    - name: repo-url
    - name: revision
    - name: image-name

  resourcetemplates:
    - apiVersion: tekton.dev/v1
      kind: PipelineRun
      metadata:
        generateName: triggered-build-
      spec:
        pipelineRef:
          name: build-test-deploy
        params:
          - name: repo-url
            value: $(tt.params.repo-url)
          - name: revision
            value: $(tt.params.revision)
          - name: image-name
            value: $(tt.params.image-name)
        workspaces:
          - name: shared-data
            volumeClaimTemplate:
              spec:
                accessModes: [ReadWriteOnce]
                resources:
                  requests:
                    storage: 1Gi

---
# EventListener — HTTP endpoint receiving webhooks
apiVersion: triggers.tekton.dev/v1beta1
kind: EventListener
metadata:
  name: github-listener
spec:
  serviceAccountName: tekton-triggers-sa
  triggers:
    - name: github-push
      interceptors:
        - ref:
            name: github
          params:
            - name: secretRef
              value:
                secretName: github-webhook-secret
                secretKey: secret
            - name: eventTypes
              value: [push]
        - ref:
            name: cel
          params:
            - name: filter
              value: body.ref == 'refs/heads/main'
      bindings:
        - ref: github-push-binding
      template:
        ref: build-deploy-template
```

---

## Tekton Chains — Segurança da Cadeia de Suprimentos

Tekton Chains é executado como um controller que monitora TaskRuns. Quando um TaskRun é concluído, o Chains:

1. Captura as entradas/saídas e parâmetros da Task
2. Gera um atestado in-toto (proveniência SLSA)
3. Assina com a chave configurada (cosign / KMS)
4. Armazena a assinatura como uma anotação no TaskRun

```yaml
# chains-config ConfigMap (in tekton-chains namespace)
apiVersion: v1
kind: ConfigMap
metadata:
  name: chains-config
  namespace: tekton-chains
data:
  # Artifact to sign
  artifacts.taskrun.format: slsa/v1
  artifacts.taskrun.storage: oci

  # Image signing
  artifacts.oci.format: simplesigning
  artifacts.oci.storage: oci

  # Transparency log
  transparency.enabled: "true"
  transparency.url: https://rekor.sigstore.dev
```

```bash
# Generate signing key pair
cosign generate-key-pair k8s://tekton-chains/signing-secrets

# Verify a signed image after pipeline
cosign verify --key cosign.pub ghcr.io/my-org/my-app:sha-abc123

# Verify SLSA provenance
cosign verify-attestation \
  --key cosign.pub \
  --type slsaprovenance \
  ghcr.io/my-org/my-app:sha-abc123
```

---

## Tekton Hub & Resolvers

```yaml
# Use a Task from Tekton Hub via the hub resolver
taskRef:
  resolver: hub
  params:
    - name: catalog
      value: tekton-catalog-tasks
    - name: type
      value: artifact
    - name: kind
      value: task
    - name: name
      value: kaniko
    - name: version
      value: "0.6"

# Use a Task from a Git repo
taskRef:
  resolver: git
  params:
    - name: url
      value: https://github.com/my-org/tekton-tasks
    - name: revision
      value: main
    - name: pathInRepo
      value: tasks/build-image/task.yaml

# Use a ClusterTask (deprecated) or local Task
taskRef:
  name: my-local-task
```

---

## Referência Rápida da CLI tkn

```bash
# List pipelines
tkn pipeline list

# Run a pipeline
tkn pipeline start build-test-deploy \
  -p repo-url=https://github.com/my-org/app \
  -w name=shared-data,claimName=my-pvc

# Watch a PipelineRun
tkn pipelinerun logs build-test-deploy-abc123 -f

# List TaskRuns
tkn taskrun list --label tekton.dev/pipeline=build-test-deploy

# Describe a Task
tkn task describe build-push-image

# Delete old PipelineRuns (keep last 5)
tkn pipelinerun delete --keep 5

# Trigger an EventListener
curl -X POST http://el-github-listener.tekton-pipelines.svc:8080 \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d @payload.json
```

---

## Melhores Práticas

| Prática | Implementação |
|----------|---------------|
| **Use Resolvers** | Referencie Tasks do Hub ou Git — evite copiar e colar |
| **Fixe versões de Task** | Especifique o `version` exato nos parâmetros do resolver |
| **Workspaces ao invés de variáveis de ambiente** | Passe arquivos entre Tasks via workspaces compartilhados |
| **Resultados de Task** | Conecte saídas entre Tasks sem armazenamento por canal lateral |
| **Kaniko para builds de imagem** | Builds sem root e sem daemon dentro do Kubernetes |
| **Tekton Chains** | Habilite para proveniência SLSA automática em cada TaskRun |
| **Limites de recursos** | Defina CPU/memória em todos os Passos — evite problemas de vizinho barulhento |
| **Passos sem root** | Execute Passos com `runAsNonRoot: true` por segurança |
| **Limpeza de PipelineRun** | Use `tektoncd/pruner` ou `tkn pipelinerun delete --keep` |
| **RBAC do Dashboard** | Restrinja o acesso ao Dashboard; ele exibe segredos via conteúdo dos workspaces |

[← Jenkins](jenkins.md) | [← Visão Geral de CI/CD](index.md) | [Azure DevOps →](azure-devops.md)
