---
title: Kubernetes
description: Referência de objetos principais, workloads, rede, RBAC, armazenamento, autoescalonamento e gerenciamento de recursos do Kubernetes.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / kubernetes</span>
    <h1 class="dph-title">Kubernetes</h1>
    <p class="dph-desc">A plataforma de orquestração de contêineres de facto. Gerenciamento declarativo de workloads, implantações autorreparáveis, RBAC granular, abstrações flexíveis de rede e armazenamento — tudo impulsionado por um poderoso plano de controle baseado em reconciliação.</p>
    <div class="dph-badges">
      <span class="tech-badge">Workloads</span>
      <span class="tech-badge">Networking</span>
      <span class="tech-badge">RBAC</span>
      <span class="tech-badge">Storage</span>
      <span class="tech-badge">Autoscaling</span>
      <span class="tech-badge">kubectl</span>
    </div>
  </div>
</div>

[← Docker](docker.md) | [← Containers Overview](index.md) | [Service Mesh →](service-mesh.md)

---

## Referência de Objetos Principais

| Objeto | Grupo de API | Descrição |
|--------|-----------|-------------|
| **Pod** | core/v1 | Unidade atômica — um ou mais contêineres compartilhando rede/armazenamento |
| **ReplicaSet** | apps/v1 | Mantém N réplicas idênticas de pod |
| **Deployment** | apps/v1 | Atualizações progressivas declarativas sobre ReplicaSets |
| **StatefulSet** | apps/v1 | Pods com identidade estável e ordenada (bancos de dados, filas) |
| **DaemonSet** | apps/v1 | Um pod por nó (agentes de log, monitoramento) |
| **Job** | batch/v1 | Workload de execução até conclusão |
| **CronJob** | batch/v1 | Jobs agendados |
| **Service** | core/v1 | Endpoint de rede estável para pods |
| **Ingress** | networking.k8s.io/v1 | Roteamento HTTP L7 |
| **ConfigMap** | core/v1 | Dados de configuração não sensíveis |
| **Secret** | core/v1 | Dados sensíveis (codificados em base64, protegidos por RBAC) |
| **PersistentVolume** | core/v1 | Recurso de armazenamento no nível do cluster |
| **PersistentVolumeClaim** | core/v1 | Solicitação de armazenamento do usuário |
| **ServiceAccount** | core/v1 | Identidade para pods dentro do cluster |
| **NetworkPolicy** | networking.k8s.io/v1 | Regras de firewall L3/L4 entre pods |
| **HorizontalPodAutoscaler** | autoscaling/v2 | Escalar pods com base em métricas |
| **PodDisruptionBudget** | policy/v1 | Garantias de disponibilidade durante interrupções |

---

## Implantação

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
  labels:
    app: api
    version: "1.2.3"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0          # zero-downtime rolling update
  template:
    metadata:
      labels:
        app: api
        version: "1.2.3"
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: /metrics
    spec:
      serviceAccountName: api

      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        fsGroup: 65532
        seccompProfile:
          type: RuntimeDefault

      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: api

      containers:
        - name: api
          image: ghcr.io/my-org/api:1.2.3
          imagePullPolicy: IfNotPresent

          ports:
            - name: http
              containerPort: 8080
              protocol: TCP

          env:
            - name: PORT
              value: "8080"
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: db-password
            - name: APP_CONFIG
              valueFrom:
                configMapKeyRef:
                  name: api-config
                  key: config.yaml

          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 512Mi        # no CPU limit — avoid throttling

          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3

          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3

          startupProbe:
            httpGet:
              path: /healthz
              port: http
            failureThreshold: 30
            periodSeconds: 5

          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: [ALL]

          volumeMounts:
            - name: tmp
              mountPath: /tmp

      volumes:
        - name: tmp
          emptyDir: {}
```

---

## Serviços e Rede

```yaml
# ClusterIP (default) — internal only
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: production
spec:
  selector:
    app: api
  ports:
    - name: http
      port: 80
      targetPort: http           # named port on the pod
  type: ClusterIP

---
# Headless service for StatefulSet DNS
apiVersion: v1
kind: Service
metadata:
  name: postgres-headless
spec:
  clusterIP: None
  selector:
    app: postgres
  ports:
    - port: 5432

---
# Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts: [api.example.com]
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  name: http
```

---

## NetworkPolicy

```yaml
# Default deny all ingress
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes: [Ingress]

---
# Allow ingress to api only from ingress-nginx and monitoring
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-api-ingress
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
      ports:
        - port: 8080

---
# Allow api to egress to postgres only
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-api-to-postgres
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - ports:
        - port: 53              # DNS
          protocol: UDP
```

---

## RBAC

```yaml
# ServiceAccount
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/api-role   # IRSA (EKS)

---
# Role — namespace-scoped
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: api-role
  namespace: production
rules:
  - apiGroups: [""]
    resources: [secrets, configmaps]
    verbs: [get, list, watch]
  - apiGroups: [""]
    resources: [pods]
    verbs: [get, list]

---
# RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: api-rolebinding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: api
    namespace: production
roleRef:
  kind: Role
  name: api-role
  apiGroup: rbac.authorization.k8s.io

---
# ClusterRole — cluster-wide
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
  - apiGroups: [""]
    resources: [nodes]
    verbs: [get, list, watch]
```

---

## Armazenamento

```yaml
# StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3-encrypted
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  encrypted: "true"
  kmsKeyId: arn:aws:kms:us-east-1:123456789012:key/mrk-...
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Retain

---
# PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: gp3-encrypted
  resources:
    requests:
      storage: 20Gi

---
# StatefulSet using PVC template
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  serviceName: postgres-headless
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: [ReadWriteOnce]
        storageClassName: gp3-encrypted
        resources:
          requests:
            storage: 20Gi
```

---

## Autoescalonamento

=== "HPA"

    ```yaml
    apiVersion: autoscaling/v2
    kind: HorizontalPodAutoscaler
    metadata:
      name: api-hpa
      namespace: production
    spec:
      scaleTargetRef:
        apiVersion: apps/v1
        kind: Deployment
        name: api
      minReplicas: 2
      maxReplicas: 20
      metrics:
        - type: Resource
          resource:
            name: cpu
            target:
              type: Utilization
              averageUtilization: 70
        - type: Resource
          resource:
            name: memory
            target:
              type: Utilization
              averageUtilization: 80
        - type: Pods
          pods:
            metric:
              name: http_requests_per_second
            target:
              type: AverageValue
              averageValue: "1000"
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 25
              periodSeconds: 60
        scaleUp:
          policies:
            - type: Pods
              value: 4
              periodSeconds: 60
    ```

=== "VPA"

    ```yaml
    apiVersion: autoscaling.k8s.io/v1
    kind: VerticalPodAutoscaler
    metadata:
      name: api-vpa
    spec:
      targetRef:
        apiVersion: apps/v1
        kind: Deployment
        name: api
      updatePolicy:
        updateMode: "Off"         # Recommend only — don't auto-restart
      resourcePolicy:
        containerPolicies:
          - containerName: api
            minAllowed:
              cpu: 50m
              memory: 64Mi
            maxAllowed:
              cpu: 4
              memory: 4Gi
    ```

=== "KEDA"

    ```yaml
    apiVersion: keda.sh/v1alpha1
    kind: ScaledObject
    metadata:
      name: api-scaledobject
    spec:
      scaleTargetRef:
        name: api
      minReplicaCount: 0           # scale to zero when idle
      maxReplicaCount: 50
      triggers:
        - type: prometheus
          metadata:
            serverAddress: http://prometheus.monitoring.svc:9090
            metricName: http_requests_per_second
            threshold: "100"
            query: sum(rate(http_requests_total{app="api"}[2m]))
        - type: aws-sqs-queue
          metadata:
            queueURL: https://sqs.us-east-1.amazonaws.com/123456789012/jobs
            queueLength: "10"
    ```

---

## Padrões de ConfigMap e Secret

```yaml
# ConfigMap — mount as file
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
data:
  config.yaml: |
    server:
      port: 8080
      timeout: 30s
    database:
      pool_size: 10

---
# Secret — reference in env var
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
type: Opaque
stringData:                        # stringData auto base64-encodes
  db-password: "super-secret"
  api-key: "my-api-key"
```

!!! warning "Segredos externos em produção"
    Nunca faça commit de Secrets no Git. Use o [External Secrets Operator](../iac/gitops.md) com AWS Secrets Manager, GCP Secret Manager ou Azure Key Vault para sincronizar segredos no cluster automaticamente.

---

## PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2           # OR: maxUnavailable: 1
  selector:
    matchLabels:
      app: api
```

---

## Referência Rápida do kubectl

```bash
# Context management
kubectl config get-contexts
kubectl config use-context prod-cluster
kubectl config set-context --current --namespace=production

# Get resources
kubectl get pods -n production -o wide
kubectl get all -n production
kubectl get events -n production --sort-by='.lastTimestamp'

# Describe & debug
kubectl describe pod api-abc123 -n production
kubectl logs api-abc123 -n production --previous -c api  # crashed container
kubectl exec -it api-abc123 -n production -- sh

# Apply / delete
kubectl apply -f manifests/                          # apply directory
kubectl apply -k overlays/production/               # kustomize
kubectl delete -f deployment.yaml
kubectl rollout restart deployment/api -n production

# Rollout management
kubectl rollout status deployment/api -n production
kubectl rollout history deployment/api -n production
kubectl rollout undo deployment/api -n production    # rollback

# Resource management
kubectl top pods -n production
kubectl top nodes

# Port forwarding
kubectl port-forward svc/api 8080:80 -n production
kubectl port-forward pod/postgres-0 5432:5432 -n production

# Diff before apply
kubectl diff -f manifests/

# Force delete stuck pod (last resort)
kubectl delete pod api-abc123 --grace-period=0 --force -n production

# Get secret value
kubectl get secret api-secrets -n production -o jsonpath='{.data.db-password}' | base64 -d
```

[← Docker](docker.md) | [← Containers Overview](index.md) | [Service Mesh →](service-mesh.md)
