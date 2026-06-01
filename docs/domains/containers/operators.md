---
title: Operadores Kubernetes
description: CRDs, padrão de controlador, Kubebuilder, Operator SDK e referência do loop de reconciliação para engenheiros DevOps.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / operators</span>
    <h1 class="dph-title">Operadores Kubernetes</h1>
    <p class="dph-desc">Codifique conhecimento operacional de domínio em controladores Kubernetes. Custom Resource Definitions estendem a API; controladores implementam o loop de reconciliação — conduzindo continuamente o estado atual em direção ao estado desejado. Construa operadores com Kubebuilder ou o Operator SDK.</p>
    <div class="dph-badges">
      <span class="tech-badge">CRDs</span>
      <span class="tech-badge">Kubebuilder</span>
      <span class="tech-badge">Operator SDK</span>
      <span class="tech-badge">Reconciliação</span>
      <span class="tech-badge">Finalizadores</span>
      <span class="tech-badge">Webhooks</span>
    </div>
  </div>
</div>

[← Malha de Serviços](service-mesh.md) | [← Visão Geral de Contêineres](index.md) | [Segurança de Contêineres →](container-security.md)

---

## O Padrão Operador

```
User applies CR  →  Kubernetes API Server stores it
                 →  Controller watches for changes
                 →  Reconcile loop runs
                 →  Controller reads desired state from CR
                 →  Controller reads actual state from cluster/external system
                 →  Controller applies diff (create/update/delete resources)
                 →  Controller updates CR Status
                 →  Loop repeats on any change or re-queue
```

**Princípio fundamental:** O Reconcile é *idempotente* — executá-lo múltiplas vezes produz o mesmo resultado. Projete para chamadas repetidas, não para eventos únicos.

---

## Definição de Recurso Personalizado

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: databases.infra.example.com
spec:
  group: infra.example.com
  names:
    kind: Database
    listKind: DatabaseList
    plural: databases
    singular: database
    shortNames: [db]
  scope: Namespaced
  versions:
    - name: v1alpha1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: [engine, size]
              properties:
                engine:
                  type: string
                  enum: [postgres, mysql, mariadb]
                version:
                  type: string
                  default: "16"
                size:
                  type: string
                  enum: [small, medium, large]
                storageGB:
                  type: integer
                  minimum: 10
                  maximum: 1000
                  default: 20
            status:
              type: object
              properties:
                phase:
                  type: string
                endpoint:
                  type: string
                conditions:
                  type: array
                  items:
                    type: object
      subresources:
        status: {}               # enables /status subresource
      additionalPrinterColumns:
        - name: Engine
          type: string
          jsonPath: .spec.engine
        - name: Size
          type: string
          jsonPath: .spec.size
        - name: Phase
          type: string
          jsonPath: .status.phase
        - name: Age
          type: date
          jsonPath: .metadata.creationTimestamp
```

```yaml
# Custom Resource instance (CR)
apiVersion: infra.example.com/v1alpha1
kind: Database
metadata:
  name: my-postgres
  namespace: production
spec:
  engine: postgres
  version: "16"
  size: medium
  storageGB: 50
```

---

## Kubebuilder

### Estrutura do Projeto

```bash
# Prerequisites
go install sigs.k8s.io/controller-tools/cmd/controller-gen@latest
curl -L -o kubebuilder https://go.kubebuilder.io/dl/latest/$(go env GOOS)/$(go env GOARCH)
chmod +x kubebuilder && mv kubebuilder /usr/local/bin/

# Create project
mkdir database-operator && cd database-operator
kubebuilder init --domain infra.example.com --repo github.com/my-org/database-operator

# Generate API + controller skeleton
kubebuilder create api \
  --group infra \
  --version v1alpha1 \
  --kind Database \
  --resource \
  --controller

# Generate manifests (CRD, RBAC)
make manifests

# Run locally against current kubeconfig
make install   # install CRDs
make run       # run controller locally
```

### Tipos (`api/v1alpha1/database_types.go`)

```go
package v1alpha1

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

type DatabaseSpec struct {
    // +kubebuilder:validation:Enum=postgres;mysql;mariadb
    Engine string `json:"engine"`

    // +kubebuilder:default="16"
    Version string `json:"version,omitempty"`

    // +kubebuilder:validation:Enum=small;medium;large
    Size string `json:"size"`

    // +kubebuilder:validation:Minimum=10
    // +kubebuilder:validation:Maximum=1000
    // +kubebuilder:default=20
    StorageGB int32 `json:"storageGB,omitempty"`
}

type DatabaseStatus struct {
    Phase      string             `json:"phase,omitempty"`
    Endpoint   string             `json:"endpoint,omitempty"`
    Conditions []metav1.Condition `json:"conditions,omitempty" patchStrategy:"merge" patchMergeKey:"type"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="Engine",type=string,JSONPath=`.spec.engine`
// +kubebuilder:printcolumn:name="Phase",type=string,JSONPath=`.status.phase`
type Database struct {
    metav1.TypeMeta   `json:",inline"`
    metav1.ObjectMeta `json:"metadata,omitempty"`
    Spec   DatabaseSpec   `json:"spec,omitempty"`
    Status DatabaseStatus `json:"status,omitempty"`
}
```

### Controlador (`internal/controller/database_controller.go`)

```go
package controller

import (
    "context"
    "fmt"

    appsv1 "k8s.io/api/apps/v1"
    corev1 "k8s.io/api/core/v1"
    "k8s.io/apimachinery/pkg/api/errors"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/apimachinery/pkg/runtime"
    ctrl "sigs.k8s.io/controller-runtime"
    "sigs.k8s.io/controller-runtime/pkg/client"
    "sigs.k8s.io/controller-runtime/pkg/log"

    infrav1alpha1 "github.com/my-org/database-operator/api/v1alpha1"
)

type DatabaseReconciler struct {
    client.Client
    Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=infra.example.com,resources=databases,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=infra.example.com,resources=databases/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=apps,resources=statefulsets,verbs=get;list;watch;create;update;patch;delete

func (r *DatabaseReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    logger := log.FromContext(ctx)

    // 1. Fetch the Database CR
    db := &infrav1alpha1.Database{}
    if err := r.Get(ctx, req.NamespacedName, db); err != nil {
        if errors.IsNotFound(err) {
            return ctrl.Result{}, nil  // deleted — nothing to do
        }
        return ctrl.Result{}, err
    }

    // 2. Handle deletion (finalizer pattern)
    finalizerName := "infra.example.com/database-finalizer"
    if db.DeletionTimestamp != nil {
        if containsString(db.Finalizers, finalizerName) {
            if err := r.cleanupExternalResources(ctx, db); err != nil {
                return ctrl.Result{}, err
            }
            db.Finalizers = removeString(db.Finalizers, finalizerName)
            return ctrl.Result{}, r.Update(ctx, db)
        }
        return ctrl.Result{}, nil
    }

    // 3. Add finalizer
    if !containsString(db.Finalizers, finalizerName) {
        db.Finalizers = append(db.Finalizers, finalizerName)
        if err := r.Update(ctx, db); err != nil {
            return ctrl.Result{}, err
        }
    }

    // 4. Reconcile StatefulSet
    sts := r.buildStatefulSet(db)
    if err := ctrl.SetControllerReference(db, sts, r.Scheme); err != nil {
        return ctrl.Result{}, err
    }

    existing := &appsv1.StatefulSet{}
    err := r.Get(ctx, client.ObjectKeyFromObject(sts), existing)
    if errors.IsNotFound(err) {
        logger.Info("Creating StatefulSet", "name", sts.Name)
        if err := r.Create(ctx, sts); err != nil {
            return ctrl.Result{}, err
        }
    } else if err != nil {
        return ctrl.Result{}, err
    }

    // 5. Update status
    db.Status.Phase = "Running"
    db.Status.Endpoint = fmt.Sprintf("%s.%s.svc.cluster.local:5432", db.Name, db.Namespace)
    if err := r.Status().Update(ctx, db); err != nil {
        return ctrl.Result{}, err
    }

    return ctrl.Result{}, nil
}

func (r *DatabaseReconciler) SetupWithManager(mgr ctrl.Manager) error {
    return ctrl.NewControllerManagedBy(mgr).
        For(&infrav1alpha1.Database{}).
        Owns(&appsv1.StatefulSet{}).    // watch owned StatefulSets
        Complete(r)
}
```

---

## Operator SDK (Operador Baseado em Helm)

```bash
# Scaffold a Helm-based operator (wraps existing Helm chart)
operator-sdk init --plugins=helm \
  --domain=infra.example.com \
  --group=infra \
  --version=v1alpha1 \
  --kind=Database \
  --helm-chart=./charts/database

# Build and push
make docker-build docker-push IMG=ghcr.io/my-org/database-operator:v0.1.0

# Deploy to cluster
make deploy IMG=ghcr.io/my-org/database-operator:v0.1.0
```

---

## Webhooks de Admissão

```go
// Validating webhook — called before CREATE/UPDATE
func (r *Database) ValidateCreate() (admission.Warnings, error) {
    if r.Spec.Engine == "mysql" && r.Spec.StorageGB < 20 {
        return nil, fmt.Errorf("MySQL requires at least 20 GB storage")
    }
    return nil, nil
}

// Defaulting webhook — sets defaults before storage
func (r *Database) Default() {
    if r.Spec.Version == "" {
        switch r.Spec.Engine {
        case "postgres":
            r.Spec.Version = "16"
        case "mysql":
            r.Spec.Version = "8.4"
        }
    }
}
```

```yaml
# MutatingWebhookConfiguration (auto-generated by Kubebuilder)
apiVersion: admissionregistration.k8s.io/v1
kind: MutatingWebhookConfiguration
metadata:
  name: database-operator-mutating-webhook
webhooks:
  - name: mdatabase.kb.io
    clientConfig:
      service:
        name: database-operator-webhook-service
        namespace: database-operator-system
        path: /mutate-infra-example-com-v1alpha1-database
    rules:
      - apiGroups: ["infra.example.com"]
        apiVersions: ["v1alpha1"]
        operations: [CREATE, UPDATE]
        resources: ["databases"]
    sideEffects: None
    admissionReviewVersions: ["v1"]
```

---

## Operadores Conhecidos

| Operador | Finalidade |
|----------|---------|
| **cert-manager** | Ciclo de vida automatizado de certificados TLS (Let's Encrypt, Vault, ACME) |
| **External Secrets Operator** | Sincronizar segredos do AWS SM, GCP SM, Azure KV em Secrets do K8s |
| **Prometheus Operator** | Gerenciar Prometheus, Alertmanager e ServiceMonitors como CRDs |
| **Argo CD** | Entrega contínua GitOps — CRDs de Application e AppSet |
| **Strimzi** | Apache Kafka no Kubernetes |
| **CloudNativePG** | Operador PostgreSQL de nível de produção |
| **Velero** | Backup e restauração de recursos K8s e PVs |
| **KEDA** | Autoescalonamento orientado a eventos (CRDs ScaledObject, ScaledJob) |
| **Crossplane** | Provisionamento de infraestrutura como CRDs do K8s (AWS, GCP, Azure) |
| **Flux** | GitOps — CRDs GitRepository, Kustomization, HelmRelease |

---

## Modelo de Maturidade do Operador

| Nível | Capacidade |
|-------|------------|
| **1 — Instalação Básica** | Provisionamento automatizado de aplicações |
| **2 — Atualizações Contínuas** | Atualizações de patch e de versão secundária |
| **3 — Ciclo de Vida Completo** | Backup, recuperação de falhas, reconfiguração |
| **4 — Insights Profundos** | Métricas, alertas, processamento de logs, análise de workloads |
| **5 — Piloto Automático** | Escalonamento horizontal/vertical, ajuste automático de configuração, detecção de anomalias |

---

## Boas Práticas

| Prática | Detalhe |
|----------|--------|
| **Reconcile idempotente** | Seguro para chamadas repetidas — não use mutações únicas |
| **Use `ctrl.SetControllerReference`** | Objetos de propriedade são coletados pelo GC quando o CR é excluído |
| **Finalizadores para recursos externos** | Impede a exclusão do CR até que a limpeza externa seja concluída |
| **Condições de status** | Use `metav1.Condition` — formato padrão para colunas do `kubectl get` |
| **Re-enfileirar em erros transientes** | `ctrl.Result{RequeueAfter: 30*time.Second}` para tentativa |
| **Eleição de líder** | Sempre habilitar para implantações de HA (`--leader-elect`) |
| **Marcadores RBAC** | Use comentários `+kubebuilder:rbac:` — `make manifests` gera o ClusterRole correto |
| **Webhook cert-manager** | Use o cert-manager para provisionar e rotacionar certificados TLS do webhook |
| **Teste unitário com envtest** | `sigs.k8s.io/controller-runtime/pkg/envtest` inicializa um servidor de API real |
| **OLM para distribuição** | Empacote operadores para o OperatorHub com o Operator Lifecycle Manager |

[← Malha de Serviços](service-mesh.md) | [← Visão Geral de Contêineres](index.md) | [Segurança de Contêineres →](container-security.md)
