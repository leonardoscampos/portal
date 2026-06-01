---
title: Kubernetes Gerenciado
description: EKS, AKS e GKE — configuração de cluster, grupos de nós, integração IAM, complementos, atualizações e padrões operacionais.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / managed-kubernetes</span>
    <h1 class="dph-title">Kubernetes Gerenciado</h1>
    <p class="dph-desc">Kubernetes em produção sem gerenciar o plano de controle. EKS, AKS e GKE gerenciam a disponibilidade do nó mestre, patches e atualizações — permitindo que as equipes se concentrem nos workloads. Cada oferta tem padrões distintos de IAM, rede, gerenciamento de nós e complementos que valem a pena dominar.</p>
    <div class="dph-badges">
      <span class="tech-badge">EKS</span>
      <span class="tech-badge">AKS</span>
      <span class="tech-badge">GKE</span>
      <span class="tech-badge">Grupos de Nós</span>
      <span class="tech-badge">Integração IAM</span>
      <span class="tech-badge">Atualizações de Cluster</span>
    </div>
  </div>
</div>

[← Segurança de Contêineres](container-security.md) | [← Visão Geral de Contêineres](index.md)

---

## Comparação de Provedores

| Recurso | EKS (AWS) | AKS (Azure) | GKE (GCP) |
|---------|-----------|-------------|-----------|
| **Custo do plano de controle** | $0,10/hr por cluster | Gratuito | Gratuito (Autopilot: baseado em uso) |
| **Integração IAM** | IRSA (OIDC) / Pod Identity | Workload Identity (OIDC) | Workload Identity |
| **Tipos de nó** | Gerenciado, Autogerenciado, Fargate | Grupos de nós System + User | Standard, Autopilot |
| **Estratégia de atualização** | Manual / Auto (auto_upgrade) | Canais de atualização automática | Canais de lançamento |
| **CNI** | AWS VPC CNI, Calico, Cilium | Azure CNI, Kubenet, Cilium | VPC-native, Dataplane V2 (eBPF) |
| **Nós GPU** | P3, G4dn, P4d | NC-series, ND-series | Grupos de nós A100, H100, T4 |
| **Spot/preemptível** | Instâncias Spot / Karpenter | Grupos de nós Spot | Grupos de nós Spot/Preemptível |
| **Integração de segredos** | AWS Secrets Manager (ASCP) | Azure Key Vault CSI driver | Secret Manager CSI driver |
| **API do Cluster** | eksctl / Terraform | AZ CLI / Terraform | gcloud / Terraform |

---

## EKS (Amazon Elastic Kubernetes Service)

### Cluster com Terraform

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "prod-cluster"
  cluster_version = "1.30"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Public endpoint with private access
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true
  cluster_endpoint_public_access_cidrs = ["203.0.113.0/24"]  # restrict CIDR

  # Enable IRSA (OIDC provider for pod IAM)
  enable_irsa = true

  # Cluster add-ons
  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = module.ebs_csi_irsa_role.iam_role_arn
    }
  }

  eks_managed_node_groups = {
    general = {
      instance_types = ["m6i.xlarge"]
      min_size       = 2
      max_size       = 10
      desired_size   = 3

      labels = {
        role = "general"
      }

      taints = []

      update_config = {
        max_unavailable_percentage = 25
      }
    }

    gpu = {
      instance_types = ["g4dn.xlarge"]
      ami_type       = "AL2_x86_64_GPU"
      min_size       = 0
      max_size       = 5
      desired_size   = 0

      labels = { role = "gpu" }
      taints = [{
        key    = "nvidia.com/gpu"
        value  = "true"
        effect = "NO_SCHEDULE"
      }]
    }

    spot = {
      instance_types = ["m6i.xlarge", "m6a.xlarge", "m5.xlarge"]
      capacity_type  = "SPOT"
      min_size       = 0
      max_size       = 20
      desired_size   = 0
      labels         = { role = "spot" }
    }
  }

  # aws-auth ConfigMap entries
  access_entries = {
    admin = {
      kubernetes_groups = []
      principal_arn     = "arn:aws:iam::123456789012:role/AdminRole"
      policy_associations = {
        admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = {
            type = "cluster"
          }
        }
      }
    }
  }
}
```

### IRSA — Funções IAM para Contas de Serviço

```hcl
# Create IAM role trusted by the pod's service account
module "s3_irsa_role" {
  source = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"

  role_name = "app-s3-role"

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["production:app-sa"]
    }
  }

  role_policy_arns = {
    s3 = aws_iam_policy.app_s3.arn
  }
}
```

```yaml
# ServiceAccount annotated with the IAM role ARN
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/app-s3-role
```

### Karpenter — Aprovisionamento Automático de Nós

```yaml
# NodePool — replaces Cluster Autoscaler
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: general
spec:
  template:
    spec:
      requirements:
        - key: kubernetes.io/arch
          operator: In
          values: [amd64, arm64]
        - key: karpenter.sh/capacity-type
          operator: In
          values: [spot, on-demand]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: [m, c, r]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["5"]
      nodeClassRef:
        group: karpenter.k8s.aws
        kind: EC2NodeClass
        name: general
      expireAfter: 720h          # recycle nodes every 30 days

  limits:
    cpu: 1000
    memory: 4000Gi

  disruption:
    consolidationPolicy: WhenUnderutilized
    consolidateAfter: 30s
```

### Referência Rápida do eksctl

```bash
# Create cluster
eksctl create cluster \
  --name prod-cluster \
  --region us-east-1 \
  --version 1.30 \
  --nodegroup-name general \
  --node-type m6i.xlarge \
  --nodes 3 --nodes-min 2 --nodes-max 10 \
  --managed

# Update kubeconfig
aws eks update-kubeconfig --region us-east-1 --name prod-cluster

# Add Fargate profile
eksctl create fargateprofile \
  --cluster prod-cluster \
  --name serverless \
  --namespace serverless

# Upgrade control plane
eksctl upgrade cluster --name prod-cluster --version 1.30 --approve

# Upgrade nodegroup
eksctl upgrade nodegroup --cluster prod-cluster --name general --kubernetes-version 1.30
```

---

## AKS (Azure Kubernetes Service)

### Cluster com Terraform

```hcl
resource "azurerm_kubernetes_cluster" "prod" {
  name                = "prod-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "prod-aks"
  kubernetes_version  = "1.30"

  # System node pool (required)
  default_node_pool {
    name                = "system"
    vm_size             = "Standard_D4s_v5"
    os_disk_type        = "Ephemeral"
    node_count          = 3
    enable_auto_scaling = true
    min_count           = 2
    max_count           = 5
    vnet_subnet_id      = azurerm_subnet.aks.id
    only_critical_addons_enabled = true  # system pods only

    upgrade_settings {
      max_surge = "33%"
    }
  }

  # Managed identity
  identity {
    type = "SystemAssigned"
  }

  # Workload identity (OIDC)
  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  # Azure CNI with Cilium
  network_profile {
    network_plugin      = "azure"
    network_plugin_mode = "overlay"
    network_policy      = "cilium"
    ebpf_data_plane     = "cilium"
    service_cidr        = "10.96.0.0/16"
    dns_service_ip      = "10.96.0.10"
  }

  # Azure Monitor integration
  monitor_metrics { annotations_allowed = "*" }

  # Azure Key Vault CSI driver
  key_vault_secrets_provider {
    secret_rotation_enabled = true
  }

  # Auto-upgrade channel
  automatic_upgrade_channel = "patch"
  node_os_upgrade_channel   = "NodeImage"

  maintenance_window_auto_upgrade {
    frequency   = "Weekly"
    interval    = 1
    duration    = 4
    day_of_week = "Sunday"
    start_time  = "02:00"
    utc_offset  = "+00:00"
  }
}

# User node pool
resource "azurerm_kubernetes_cluster_node_pool" "general" {
  name                  = "general"
  kubernetes_cluster_id = azurerm_kubernetes_cluster.prod.id
  vm_size               = "Standard_D8s_v5"
  os_disk_type          = "Ephemeral"
  enable_auto_scaling   = true
  min_count             = 1
  max_count             = 20
  vnet_subnet_id        = azurerm_subnet.aks.id

  node_labels = { role = "general" }

  upgrade_settings {
    max_surge = "33%"
  }
}
```

### Workload Identity

```bash
# Create federated credential
az identity create --name app-identity --resource-group rg-prod

az identity federated-credential create \
  --name app-federated \
  --identity-name app-identity \
  --resource-group rg-prod \
  --issuer $(az aks show -g rg-prod -n prod-aks --query oidcIssuerProfile.issuerUrl -o tsv) \
  --subject "system:serviceaccount:production:app-sa" \
  --audience api://AzureADTokenExchange
```

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
  annotations:
    azure.workload.identity/client-id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  labels:
    azure.workload.identity/use: "true"
```

---

## GKE (Google Kubernetes Engine)

### Cluster com Terraform

```hcl
resource "google_container_cluster" "prod" {
  name     = "prod-cluster"
  location = "us-east1"             # regional (HA) cluster

  # Separate node pool — remove default
  remove_default_node_pool = true
  initial_node_count       = 1

  # VPC-native networking
  networking_mode = "VPC_NATIVE"
  network         = google_compute_network.main.name
  subnetwork      = google_compute_subnetwork.main.name

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  # Workload Identity
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # GKE Dataplane V2 (eBPF / Cilium)
  datapath_provider = "ADVANCED_DATAPATH"

  # Binary Authorization
  binary_authorization {
    evaluation_mode = "PROJECT_SINGLETON_POLICY_ENFORCE"
  }

  # Managed add-ons
  addons_config {
    http_load_balancing        { disabled = false }
    horizontal_pod_autoscaling { disabled = false }
    gcs_fuse_csi_driver_config { enabled = true }
    gcp_filestore_csi_driver_config { enabled = true }
  }

  # Release channel (auto-upgrades)
  release_channel {
    channel = "REGULAR"
  }

  # Private cluster
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    cidr_blocks {
      cidr_block   = "203.0.113.0/24"
      display_name = "office"
    }
  }
}

resource "google_container_node_pool" "general" {
  name       = "general"
  cluster    = google_container_cluster.prod.id
  location   = "us-east1"
  node_count = 1                   # per zone (regional: ×3)

  autoscaling {
    min_node_count  = 1
    max_node_count  = 10
    location_policy = "BALANCED"
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  upgrade_settings {
    strategy        = "SURGE"
    max_surge       = 1
    max_unavailable = 0
  }

  node_config {
    machine_type    = "n2-standard-4"
    disk_type       = "pd-ssd"
    disk_size_gb    = 100
    image_type      = "COS_CONTAINERD"
    spot            = false

    workload_metadata_config {
      mode = "GKE_METADATA"       # required for Workload Identity
    }

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }

    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
}
```

### GKE Workload Identity

```bash
# Bind K8s SA to GCP SA
gcloud iam service-accounts add-iam-policy-binding \
  app-sa@my-project.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:my-project.svc.id.goog[production/app-sa]"
```

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
  annotations:
    iam.gke.io/gcp-service-account: app-sa@my-project.iam.gserviceaccount.com
```

### GKE Autopilot

```hcl
resource "google_container_cluster" "autopilot" {
  name             = "autopilot-cluster"
  location         = "us-east1"
  enable_autopilot = true          # no node pool management needed

  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}
```

!!! tip "Autopilot vs Standard"
    O Autopilot gerencia nós, grupos de nós, sistema operacional e capacidade automaticamente. Você paga por solicitação de recurso de Pod (não por nó). Ideal para equipes que desejam evitar operações de nós. Restrições: sem pods privilegiados, sem DaemonSets, sem kernels personalizados.

---

## Estratégia de Atualização de Cluster

```bash
# EKS — blue/green via eksctl
eksctl create nodegroup --cluster prod --name v130-nodes --node-type m6i.xlarge --nodes 3
kubectl cordon -l alpha.eksctl.io/nodegroup-name=v129-nodes    # stop scheduling
kubectl drain -l alpha.eksctl.io/nodegroup-name=v129-nodes --ignore-daemonsets --delete-emptydir-data
eksctl delete nodegroup --cluster prod --name v129-nodes

# AKS — managed rolling upgrade
az aks upgrade --resource-group rg-prod --name prod-aks --kubernetes-version 1.30

# GKE — managed upgrade via release channel (automatic)
# Manual trigger:
gcloud container clusters upgrade prod-cluster \
  --master \
  --cluster-version 1.30 \
  --region us-east1

gcloud container clusters upgrade prod-cluster \
  --node-pool general \
  --cluster-version 1.30 \
  --region us-east1
```

---

## Checklist de Operações em Produção

| Área | Prática |
|------|----------|
| **Multi-AZ** | Distribuir grupos de nós em ≥3 zonas de disponibilidade |
| **Cluster privado** | Desabilitar acesso público ao endpoint da API; usar VPN / bastion |
| **Atualização automática de nós** | Habilitar para patches de SO; usar janelas de manutenção para controle |
| **PodDisruptionBudget** | Definir para todos os workloads stateful e críticos |
| **Cotas de recursos** | Aplicar `ResourceQuota` e `LimitRange` por namespace |
| **Autoescalonador de cluster** | Usar Karpenter (EKS), CA (AKS/GKE) ou Autopilot (GKE) |
| **Nós Spot/preemptíveis** | Usar para workloads batch e stateless para reduzir custos |
| **Backup do etcd** | O K8s gerenciado trata disso — verificar SLA e janela de PITR |
| **Logs de auditoria** | Habilitar logs de auditoria do K8s; encaminhar para SIEM |
| **Auditoria de RBAC** | Revisar regularmente `ClusterRoleBindings` e `RoleBindings` |
| **Varredura de imagens** | Habilitar varredura no push no ECR / ACR / Artifact Registry |
| **Isolamento de namespace** | NetworkPolicy + PSS aplicados por namespace |
| **Monitoramento** | Prometheus + Grafana ou nativo da nuvem (CloudWatch/AzMonitor/Cloud Ops) |

[← Segurança de Contêineres](container-security.md) | [← Visão Geral de Contêineres](index.md)
