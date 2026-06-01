---
title: Jenkins
description: Pipelines declarativas Jenkins, bibliotecas compartilhadas, agentes Kubernetes, pipelines multibranch e referência de credenciais.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / jenkins</span>
    <h1 class="dph-title">Jenkins</h1>
    <p class="dph-desc">O servidor de automação open-source battle-tested. Pipelines Declarativas e Scriptadas via Jenkinsfile, um enorme ecossistema de plugins, agentes efêmeros nativos do Kubernetes, bibliotecas compartilhadas para pipelines DRY e integração profunda com praticamente todas as ferramentas do stack DevOps.</p>
    <div class="dph-badges">
      <span class="tech-badge">Declarative Pipeline</span>
      <span class="tech-badge">Shared Libraries</span>
      <span class="tech-badge">K8s Agents</span>
      <span class="tech-badge">Multibranch</span>
      <span class="tech-badge">Blue Ocean</span>
      <span class="tech-badge">Credentials</span>
    </div>
  </div>
</div>

[← GitLab CI](gitlab-ci.md) | [← Visão Geral de CI/CD](index.md) | [Tekton →](tekton.md)

---

## Anatomia do Pipeline Declarativo

```groovy
// Jenkinsfile
pipeline {
    agent {
        kubernetes {
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                  containers:
                  - name: maven
                    image: maven:3.9-eclipse-temurin-21
                    command: [sleep]
                    args: [infinity]
                  - name: docker
                    image: docker:25-dind
                    securityContext:
                      privileged: true
            '''
            defaultContainer 'maven'
        }
    }

    environment {
        REGISTRY     = 'ghcr.io/my-org'
        IMAGE_TAG    = "${env.GIT_COMMIT[0..7]}"
        KUBECONFIG   = credentials('k8s-kubeconfig')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    triggers {
        pollSCM('H/5 * * * *')   // poll every 5 min (prefer webhooks)
    }

    stages {
        stage('Build') {
            steps {
                sh 'mvn -B -DskipTests clean package'
                archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
            }
        }

        stage('Test') {
            steps {
                sh 'mvn -B test'
            }
            post {
                always {
                    junit 'target/surefire-reports/**/*.xml'
                    jacoco execPattern: 'target/jacoco.exec'
                }
            }
        }

        stage('Build & Push Image') {
            steps {
                container('docker') {
                    withCredentials([usernamePassword(
                        credentialsId: 'ghcr-credentials',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )]) {
                        sh '''
                            docker login ghcr.io -u $DOCKER_USER -p $DOCKER_PASS
                            docker build -t $REGISTRY/app:$IMAGE_TAG .
                            docker push $REGISTRY/app:$IMAGE_TAG
                        '''
                    }
                }
            }
        }

        stage('Deploy Staging') {
            when {
                branch 'main'
            }
            steps {
                sh 'helm upgrade --install app ./helm -f values-staging.yaml --set image.tag=$IMAGE_TAG'
            }
        }

        stage('Deploy Production') {
            when {
                branch 'main'
            }
            input {
                message 'Deploy to production?'
                ok 'Deploy'
                parameters {
                    string(name: 'REASON', description: 'Deployment reason')
                }
            }
            steps {
                sh 'helm upgrade --install app ./helm -f values-prod.yaml --set image.tag=$IMAGE_TAG'
            }
        }
    }

    post {
        success {
            slackSend channel: '#deploys', color: 'good', message: "✅ ${env.JOB_NAME} #${env.BUILD_NUMBER} succeeded"
        }
        failure {
            slackSend channel: '#deploys', color: 'danger', message: "❌ ${env.JOB_NAME} #${env.BUILD_NUMBER} failed"
        }
        always {
            cleanWs()
        }
    }
}
```

---

## Tipos de Pipeline

| Tipo | Caso de Uso |
|------|----------|
| **Declarativo** | DSL padrão semelhante a YAML. Impõe estrutura; preferido para novos pipelines |
| **Scriptado** | Groovy completo — máxima flexibilidade, mas mais difícil de manter |
| **Multibranch** | Escaneia branches/PRs do repositório e cria pipeline por branch automaticamente |
| **Organization** | Escaneia toda a org GitHub/GitLab ou projeto Bitbucket |
| **Blue Ocean** | UI moderna sobre pipelines existentes — visualização e integração com PRs |

---

## Bibliotecas Compartilhadas

```
vars/
  deployHelm.groovy
  dockerBuild.groovy
src/
  org/example/
    Utils.groovy
resources/
  org/example/
    Dockerfile.template
```

```groovy
// vars/deployHelm.groovy
def call(Map config) {
    def chart     = config.chart     ?: 'app'
    def namespace = config.namespace ?: 'default'
    def imageTag  = config.imageTag

    sh """
        helm upgrade --install ${chart} ./helm \
          --namespace ${namespace} \
          --set image.tag=${imageTag} \
          --wait --timeout 5m
    """
}
```

```groovy
// Jenkinsfile — consuming the shared library
@Library('my-shared-lib@main') _

pipeline {
    agent any
    stages {
        stage('Deploy') {
            steps {
                deployHelm chart: 'backend', namespace: 'production', imageTag: env.GIT_COMMIT[0..7]
            }
        }
    }
}
```

**Registrar biblioteca:** *Manage Jenkins → System → Global Pipeline Libraries*

---

## Templates de Pod Kubernetes

=== "YAML Inline (preferido)"

    ```groovy
    pipeline {
        agent {
            kubernetes {
                yaml '''
                    apiVersion: v1
                    kind: Pod
                    spec:
                      serviceAccountName: jenkins-agent
                      containers:
                      - name: terraform
                        image: hashicorp/terraform:1.8
                        command: [sleep]
                        args: [infinity]
                        env:
                        - name: AWS_REGION
                          value: us-east-1
                      - name: kubectl
                        image: bitnami/kubectl:1.30
                        command: [sleep]
                        args: [infinity]
                '''
                defaultContainer 'terraform'
                retries 2
            }
        }
    }
    ```

=== "Pod Template na UI do Jenkins"

    Configure em **Manage Jenkins → Clouds → Kubernetes → Pod Templates**.  
    Referencie pelo label no Jenkinsfile:

    ```groovy
    pipeline {
        agent { label 'terraform-agent' }
        stages { ... }
    }
    ```

---

## Gerenciamento de Credenciais

```groovy
// String / secret text
withCredentials([string(credentialsId: 'api-token', variable: 'TOKEN')]) {
    sh 'curl -H "Authorization: Bearer $TOKEN" https://api.example.com'
}

// Username + password
withCredentials([usernamePassword(
    credentialsId: 'docker-hub',
    usernameVariable: 'USER',
    passwordVariable: 'PASS'
)]) {
    sh 'docker login -u $USER -p $PASS'
}

// SSH key
withCredentials([sshUserPrivateKey(
    credentialsId: 'deploy-key',
    keyFileVariable: 'KEY_FILE',
    usernameVariable: 'SSH_USER'
)]) {
    sh 'ssh -i $KEY_FILE $SSH_USER@server.example.com deploy.sh'
}

// Secret file
withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
    sh 'kubectl get pods'
}
```

---

## Multibranch Pipeline

```groovy
// Jenkinsfile at repo root — automatically discovered per branch/PR
pipeline {
    agent any

    stages {
        stage('Test') {
            steps {
                sh 'npm ci && npm test'
            }
        }

        stage('Deploy') {
            when {
                anyOf {
                    branch 'main'
                    branch 'release/*'
                }
            }
            steps {
                sh './deploy.sh $BRANCH_NAME'
            }
        }
    }
}
```

Configure na UI do Jenkins: **New Item → Multibranch Pipeline → Branch Sources → GitHub/GitLab**.  
Habilite *Discover branches*, *Discover pull requests* e defina o intervalo de varredura.

---

## Estágios Paralelos

```groovy
stage('Test in parallel') {
    parallel {
        stage('Unit tests') {
            steps {
                sh 'go test ./... -run Unit'
            }
        }
        stage('Integration tests') {
            agent { label 'integration' }
            steps {
                sh 'go test ./... -run Integration'
            }
        }
        stage('Lint') {
            steps {
                sh 'golangci-lint run'
            }
        }
    }
}
```

---

## Matrix (Declarativo)

```groovy
stage('Multi-platform build') {
    matrix {
        axes {
            axis {
                name 'PLATFORM'
                values 'linux/amd64', 'linux/arm64'
            }
            axis {
                name 'GO_VERSION'
                values '1.21', '1.22'
            }
        }
        excludes {
            exclude {
                axis { name 'PLATFORM'; values 'linux/arm64' }
                axis { name 'GO_VERSION'; values '1.21' }
            }
        }
        stages {
            stage('Build') {
                steps {
                    sh "GOARCH=${PLATFORM.split('/')[1]} go build ./..."
                }
            }
        }
    }
}
```

---

## Plugins Essenciais

| Plugin | Finalidade |
|--------|------|
| **Pipeline** | Suporte central a pipelines declarativas/scriptadas |
| **Git** | Integração com SCM |
| **GitHub Branch Source** | Multibranch + varredura de org para GitHub |
| **GitLab Branch Source** | Multibranch + varredura de org para GitLab |
| **Kubernetes** | Agentes efêmeros baseados em pods no K8s |
| **Credentials Binding** | DSL `withCredentials {}` |
| **Blue Ocean** | UI moderna de visualização de pipelines |
| **Pipeline: Shared Groovy Libraries** | Suporte a bibliotecas compartilhadas |
| **Docker Pipeline** | DSL `docker.build`, `docker.withRegistry` |
| **JUnit** | Publicação de resultados de testes |
| **Cobertura / JaCoCo** | Relatórios de cobertura de código |
| **Slack Notification** | Mensagens Slack a partir dos pipelines |
| **OWASP Dependency-Check** | Varredura de vulnerabilidades em dependências |
| **SonarQube Scanner** | Integração de análise estática |

---

## Configuração como Código (JCasC)

```yaml
# jenkins.yaml — loaded at startup via Configuration as Code plugin
jenkins:
  systemMessage: "Jenkins managed by JCasC"
  numExecutors: 0               # controller runs no jobs

  clouds:
    - kubernetes:
        name: kubernetes
        serverUrl: https://kubernetes.default
        namespace: jenkins
        jenkinsUrl: http://jenkins.jenkins.svc:8080
        jenkinsTunnel: jenkins-agent.jenkins.svc:50000
        templates:
          - name: default
            namespace: jenkins
            label: default
            containers:
              - name: jnlp
                image: jenkins/inbound-agent:3206.vb_15dcf73f6a_9-1

credentials:
  system:
    domainCredentials:
      - credentials:
          - usernamePassword:
              scope: GLOBAL
              id: docker-hub
              username: myuser
              password: ${DOCKER_HUB_PASSWORD}
```

---

## Melhores Práticas

| Prática | Implementação |
|----------|---------------|
| **Jenkinsfile no SCM** | Armazene pipelines no controle de versão — nunca use o editor da UI |
| **Agentes K8s efêmeros** | Agentes baseados em pods escalam a zero; sem manutenção de agentes persistentes |
| **Bibliotecas compartilhadas** | Centralize a lógica DRY; fixe versões das referências de biblioteca em produção |
| **Declarativo sobre Scriptado** | Mais fácil de ler, validar e lintar; use `when`, `input`, `matrix` |
| **JCasC para configuração do controller** | Instalações Jenkins reproduzíveis — sem configuração manual na UI |
| **Somente plugin de Credenciais** | Nunca faça hardcode de segredos; sempre use `withCredentials {}` |
| **Build discarder** | Defina `logRotator` para evitar esgotamento de disco |
| **Paralelo & Matrix** | Reduza o tempo de parede executando estágios independentes em paralelo |
| **Timeout nos estágios** | Evite builds travados com `timeout(time: N, unit: 'MINUTES')` |
| **cleanWs() no post** | Libere o workspace após o build para evitar acúmulo de disco nos agentes |

[← GitLab CI](gitlab-ci.md) | [← Visão Geral de CI/CD](index.md) | [Tekton →](tekton.md)
