---
title: Jenkins
description: Jenkins declarative pipelines, shared libraries, Kubernetes agents, multibranch pipelines and credentials reference.
---

<div class="domain-page-hero" data-domain="cicd">
  <div class="dph-left">
    <span class="dph-eyebrow">// cicd-pipelines / jenkins</span>
    <h1 class="dph-title">Jenkins</h1>
    <p class="dph-desc">The battle-tested open-source automation server. Declarative and Scripted Pipelines via Jenkinsfile, an enormous plugin ecosystem, Kubernetes-native ephemeral agents, shared libraries for DRY pipelines and deep integration with virtually every tool in the DevOps stack.</p>
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

[← GitLab CI](gitlab-ci.md) | [← CI/CD Overview](index.md) | [Tekton →](tekton.md)

---

## Declarative Pipeline Anatomy

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

## Pipeline Types

| Type | Use Case |
|------|----------|
| **Declarative** | Standard YAML-like DSL. Enforces structure, preferred for new pipelines |
| **Scripted** | Full Groovy — maximum flexibility but harder to maintain |
| **Multibranch** | Scans repo branches/PRs, creates pipeline per branch automatically |
| **Organization** | Scans entire GitHub/GitLab org or Bitbucket project |
| **Blue Ocean** | Modern UI over existing pipelines — visualization and PR integration |

---

## Shared Libraries

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

**Register library:** *Manage Jenkins → System → Global Pipeline Libraries*

---

## Kubernetes Pod Templates

=== "Inline YAML (preferred)"

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

=== "Pod Template in Jenkins UI"

    Configure under **Manage Jenkins → Clouds → Kubernetes → Pod Templates**.  
    Reference by label in the Jenkinsfile:

    ```groovy
    pipeline {
        agent { label 'terraform-agent' }
        stages { ... }
    }
    ```

---

## Credentials Management

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

Configure in Jenkins UI: **New Item → Multibranch Pipeline → Branch Sources → GitHub/GitLab**.  
Enable *Discover branches*, *Discover pull requests*, and set scan interval.

---

## Parallel Stages

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

## Matrix (Declarative)

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

## Essential Plugins

| Plugin | Purpose |
|--------|---------|
| **Pipeline** | Core declarative/scripted pipeline support |
| **Git** | SCM integration |
| **GitHub Branch Source** | Multibranch + org scan for GitHub |
| **GitLab Branch Source** | Multibranch + org scan for GitLab |
| **Kubernetes** | Ephemeral pod-based agents in K8s |
| **Credentials Binding** | `withCredentials {}` DSL |
| **Blue Ocean** | Modern pipeline visualization UI |
| **Pipeline: Shared Groovy Libraries** | Shared library support |
| **Docker Pipeline** | `docker.build`, `docker.withRegistry` DSL |
| **JUnit** | Test result publishing |
| **Cobertura / JaCoCo** | Code coverage reporting |
| **Slack Notification** | Slack messages from pipelines |
| **OWASP Dependency-Check** | Dependency vulnerability scanning |
| **SonarQube Scanner** | Static analysis integration |

---

## Configuration as Code (JCasC)

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

## Best Practices

| Practice | Implementation |
|----------|---------------|
| **Jenkinsfile in SCM** | Store pipelines in version control — never use the UI editor |
| **Ephemeral K8s agents** | Pod-based agents scale to zero; no persistent agent maintenance |
| **Shared libraries** | Centralise DRY logic; version-pin library refs in production |
| **Declarative over Scripted** | Easier to read, validate and lint; use `when`, `input`, `matrix` |
| **JCasC for controller config** | Reproducible Jenkins installs — no manual UI configuration |
| **Credentials plugin only** | Never hardcode secrets; use `withCredentials {}` always |
| **Build discarder** | Set `logRotator` to avoid disk exhaustion |
| **Parallel & Matrix** | Reduce wall-clock time by running independent stages in parallel |
| **Timeout on stages** | Prevent hung builds with `timeout(time: N, unit: 'MINUTES')` |
| **cleanWs() in post** | Free workspace after build to avoid disk buildup on agents |

[← GitLab CI](gitlab-ci.md) | [← CI/CD Overview](index.md) | [Tekton →](tekton.md)
