---
title: Kubernetes Operators
description: CRDs, controller pattern, Kubebuilder, Operator SDK and reconciliation loop reference for DevOps engineers.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / operators</span>
    <h1 class="dph-title">Kubernetes Operators</h1>
    <p class="dph-desc">Encode operational domain knowledge into Kubernetes controllers. Custom Resource Definitions extend the API; controllers implement the reconciliation loop — continuously driving actual state towards desired state. Build operators with Kubebuilder or the Operator SDK.</p>
    <div class="dph-badges">
      <span class="tech-badge">CRDs</span>
      <span class="tech-badge">Kubebuilder</span>
      <span class="tech-badge">Operator SDK</span>
      <span class="tech-badge">Reconciliation</span>
      <span class="tech-badge">Finalizers</span>
      <span class="tech-badge">Webhooks</span>
    </div>
  </div>
</div>

[← Service Mesh](service-mesh.md) | [← Containers Overview](index.md) | [Container Security →](container-security.md)

---

## The Operator Pattern

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

**Key principle:** Reconcile is *idempotent* — running it multiple times produces the same result. Design for repeated calls, not event-driven one-shots.

---

## Custom Resource Definition

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

### Project Scaffold

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

### Types (`api/v1alpha1/database_types.go`)

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

### Controller (`internal/controller/database_controller.go`)

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

## Operator SDK (Helm-based Operator)

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

## Admission Webhooks

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

## Well-Known Operators

| Operator | Purpose |
|----------|---------|
| **cert-manager** | Automated TLS certificate lifecycle (Let's Encrypt, Vault, ACME) |
| **External Secrets Operator** | Sync secrets from AWS SM, GCP SM, Azure KV into K8s Secrets |
| **Prometheus Operator** | Manage Prometheus, Alertmanager and ServiceMonitors as CRDs |
| **Argo CD** | GitOps continuous delivery — Application and AppSet CRDs |
| **Strimzi** | Apache Kafka on Kubernetes |
| **CloudNativePG** | Production-grade PostgreSQL operator |
| **Velero** | Backup and restore K8s resources and PVs |
| **KEDA** | Event-driven autoscaling (ScaledObject, ScaledJob CRDs) |
| **Crossplane** | Infrastructure provisioning as K8s CRDs (AWS, GCP, Azure) |
| **Flux** | GitOps — GitRepository, Kustomization, HelmRelease CRDs |

---

## Operator Maturity Model

| Level | Capability |
|-------|------------|
| **1 — Basic Install** | Automated application provisioning |
| **2 — Seamless Upgrades** | Patch and minor version upgrades |
| **3 — Full Lifecycle** | Backup, failure recovery, reconfiguration |
| **4 — Deep Insights** | Metrics, alerts, log processing, workload analysis |
| **5 — Auto Pilot** | Horizontal/vertical scaling, auto config tuning, anomaly detection |

---

## Best Practices

| Practice | Detail |
|----------|--------|
| **Idempotent reconcile** | Safe to call repeatedly — don't use one-shot mutations |
| **Use `ctrl.SetControllerReference`** | Owned objects get garbage collected when CR is deleted |
| **Finalizers for external resources** | Prevent CR deletion until external cleanup completes |
| **Status conditions** | Use `metav1.Condition` — standard format for `kubectl get` columns |
| **Re-queue on transient errors** | `ctrl.Result{RequeueAfter: 30*time.Second}` for retry |
| **Leader election** | Always enable for HA deployments (`--leader-elect`) |
| **RBAC markers** | Use `+kubebuilder:rbac:` comments — `make manifests` generates correct ClusterRole |
| **Webhook cert-manager** | Use cert-manager to provision and rotate webhook TLS certificates |
| **Unit test with envtest** | `sigs.k8s.io/controller-runtime/pkg/envtest` spins up a real API server |
| **OLM for distribution** | Package operators for OperatorHub with Operator Lifecycle Manager |

[← Service Mesh](service-mesh.md) | [← Containers Overview](index.md) | [Container Security →](container-security.md)
