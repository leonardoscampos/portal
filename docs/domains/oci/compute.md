---
title: OCI Computação
description: Instâncias de Computação, OKE, Container Instances, Oracle Functions — computação na Oracle Cloud Infrastructure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / compute</span>
    <h1 class="dph-title">OCI Computação</h1>
    <p class="dph-desc">O OCI Compute abrange desde bare-metal até instâncias Ampere A1 baseadas em ARM com a melhor relação preço/desempenho do mercado. O OKE (Oracle Container Engine for Kubernetes) oferece um plano de controle Kubernetes totalmente gerenciado com nós virtuais para cargas de trabalho de contêineres serverless.</p>
    <div class="dph-badges">
      <span class="tech-badge">Compute Instances</span>
      <span class="tech-badge">OKE</span>
      <span class="tech-badge">Ampere A1</span>
      <span class="tech-badge">Container Instances</span>
      <span class="tech-badge">Oracle Functions</span>
    </div>
  </div>
</div>

---

## Instâncias de Computação

As instâncias de Computação OCI utilizam um modelo de **forma** — a forma define as características de CPU, memória, rede e armazenamento. **Formas flexíveis** (`.Flex`) permitem ajustar vCPU e memória de forma independente.

### Famílias de formas

| Forma | Arquitetura | vCPU / Memória | Notas |
|-------|-------------|----------------|-------|
| **VM.Standard.E5.Flex** | AMD EPYC Genoa | 1–94 vCPU, 1–1049 GB | Mais versátil para uso geral |
| **VM.Standard.A1.Flex** | Ampere Altra ARM | 1–80 vCPU, 1–512 GB | **Melhor preço/desempenho**; camada Always Free |
| **VM.Standard3.Flex** | Intel Ice Lake | 1–32 vCPU, 1–512 GB | Cargas de trabalho exclusivamente Intel |
| **BM.Standard.E5.96** | AMD EPYC, bare-metal | 96 vCPU, 1024 GB | Sem overhead de hypervisor |
| **VM.GPU.A10.1** | NVIDIA A10 GPU | 15 vCPU, 240 GB, 1× A10 | Inferência de ML |

!!! tip "Ampere A1 Always Free"
    A camada Always Free do OCI inclui **4 OCPUs Ampere A1 e 24 GB de RAM** de forma permanente — suficiente para executar um pequeno cluster Kubernetes ou múltiplos microsserviços sem custo. As instâncias A1 também custam 30–50% menos do que outras ofertas ARM na nuvem.

### Configuração de instância

```hcl
data "oci_core_images" "oracle_linux" {
  compartment_id           = var.compartment_id
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_id
  shape               = "VM.Standard.A1.Flex"
  display_name        = "${var.project}-app"

  shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.oracle_linux.images[0].id
    boot_volume_size_in_gbs = 100
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.app.id
    assign_public_ip = false
    nsg_ids          = [oci_core_network_security_group.app.id]
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data           = base64encode(file("cloud-init.yaml"))
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true  # use v2 IMDS only
  }
}
```

### Grupos de Instâncias (autoscaling)

```hcl
resource "oci_core_instance_configuration" "app" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-app-config"

  instance_details {
    instance_type = "compute"
    launch_details {
      compartment_id = var.compartment_id
      shape          = "VM.Standard.A1.Flex"
      shape_config {
        ocpus         = 2
        memory_in_gbs = 12
      }
      source_details {
        source_type = "image"
        image_id    = data.oci_core_images.oracle_linux.images[0].id
      }
    }
  }
}

resource "oci_core_instance_pool" "app" {
  compartment_id            = var.compartment_id
  instance_configuration_id = oci_core_instance_configuration.app.id
  display_name              = "${var.project}-app-pool"
  size                      = 2

  placement_configurations {
    availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
    primary_subnet_id   = oci_core_subnet.app.id
  }
}
```

---

## OKE — Oracle Container Engine for Kubernetes

O OKE é o serviço Kubernetes gerenciado da Oracle. O plano de controle é totalmente gerenciado, multi-AD (Availability Domain) e sem custo. Você paga apenas pelos nós de trabalho. O OKE suporta tanto nós gerenciados quanto **nós virtuais** (serverless).

### Tipos de nós

| Tipo | Descrição | Caso de uso |
|------|-----------|-------------|
| **Nós gerenciados** | VMs que você provisiona em grupos de nós; você gerencia o patch do SO | Cargas de trabalho padrão, GPU |
| **Nós virtuais** | Pods serverless — sem gerenciamento de VM; a OCI gerencia a infraestrutura | Escalar a zero, cargas de trabalho com picos |
| **Nós autogerenciados** | VMs que você adiciona manualmente | SO personalizado, configurações BYOK |

```hcl
resource "oci_containerengine_cluster" "main" {
  compartment_id     = var.compartment_id
  name               = "${var.project}-oke"
  kubernetes_version = "v1.29.1"
  vcn_id             = oci_core_vcn.main.id

  endpoint_config {
    is_public_ip_enabled = false   # private endpoint (recommended)
    subnet_id            = oci_core_subnet.oke_api.id
    nsg_ids              = [oci_core_network_security_group.oke_api.id]
  }

  options {
    kubernetes_network_config {
      pods_cidr     = "10.244.0.0/16"
      services_cidr = "10.96.0.0/16"
    }
    service_lb_subnet_ids = [oci_core_subnet.oke_lb.id]

    add_ons {
      is_kubernetes_dashboard_enabled = false
      is_tiller_enabled               = false
    }
  }

  cluster_pod_network_options { cni_type = "OCI_VCN_IP_NATIVE" }  # native VCN IPs for pods
}

resource "oci_containerengine_node_pool" "app" {
  cluster_id         = oci_containerengine_cluster.main.id
  compartment_id     = var.compartment_id
  name               = "app-pool"
  kubernetes_version = "v1.29.1"

  node_config_details {
    size = 3
    placement_configs {
      availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
      subnet_id           = oci_core_subnet.oke_workers.id
    }
    node_pool_pod_network_option_details { cni_type = "OCI_VCN_IP_NATIVE" }
  }

  node_shape = "VM.Standard.A1.Flex"
  node_shape_config {
    ocpus         = 4
    memory_in_gbs = 24
  }

  node_source_details {
    source_type             = "IMAGE"
    image_id                = data.oci_core_images.oke_node.images[0].id
    boot_volume_size_in_gbs = 100
  }
}
```

### OKE Workload Identity

O OKE Workload Identity permite que pods assumam papéis do OCI IAM sem Instance Principals ou credenciais estáticas. Os pods apresentam um token OIDC; o OCI IAM valida e retorna credenciais de curta duração.

```yaml
# Pod spec — annotate service account for Workload Identity
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app
  namespace: production
  annotations:
    oci.oracle.com/workload-identity: "true"
```

---

## Container Instances

As OCI Container Instances são contêineres totalmente serverless — sem cluster, sem grupos de nós. Ideais para jobs de curta duração, etapas de CI, tarefas avulsas ou ambientes de staging que não precisam de um cluster persistente.

```hcl
resource "oci_container_instances_container_instance" "job" {
  compartment_id      = var.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "data-pipeline-job"
  shape               = "CI.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 8
  }

  vnics {
    subnet_id = oci_core_subnet.jobs.id
  }

  containers {
    display_name = "pipeline"
    image_url    = "${var.region}.ocir.io/${var.tenancy_namespace}/pipeline:latest"

    resource_config {
      vcpus_limit         = 2
      memory_limit_in_gbs = 8
    }

    environment_variables = {
      ENV          = var.env
      INPUT_BUCKET = var.input_bucket
    }
  }
}
```

---

## Oracle Functions

O Oracle Functions é o serviço de computação serverless da OCI baseado no **Fn Project** (open-source). As Functions são empacotadas como imagens Docker e acionadas via HTTP, OCI Events, OCI Queues ou Oracle Integration.

```python
# Python handler
import io
import json
import logging
from fdk import response

def handler(ctx, data: io.BytesIO = None):
    try:
        body = json.loads(data.getvalue())
        name = body.get("name", "World")
        return response.Response(
            ctx,
            response_data=json.dumps({"message": f"Hello, {name}!"}),
            headers={"Content-Type": "application/json"}
        )
    except Exception as ex:
        logging.error(str(ex))
        raise
```

```hcl
resource "oci_functions_application" "api" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-functions"
  subnet_ids     = [oci_core_subnet.functions.id]
  config         = { LOG_LEVEL = "INFO" }
}

resource "oci_functions_function" "hello" {
  application_id = oci_functions_application.api.id
  display_name   = "hello"
  image          = "${var.region}.ocir.io/${var.tenancy_namespace}/hello:0.1.0"
  memory_in_mbs  = 256
  timeout_in_seconds = 30

  provisioned_concurrency_config {
    strategy = "CONSTANT"
    count    = 5   # pre-warmed instances
  }
}
```

---

[← Visão Geral OCI](index.md){ .md-button }
[Armazenamento →](storage.md){ .md-button .md-button--primary }
