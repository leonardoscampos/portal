---
title: OCI Compute
description: Compute Instances, OKE, Container Instances, Oracle Functions — compute on Oracle Cloud Infrastructure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / compute</span>
    <h1 class="dph-title">OCI Compute</h1>
    <p class="dph-desc">OCI Compute spans bare-metal to ARM-based Ampere A1 instances with the best price/performance in the industry. OKE (Oracle Container Engine for Kubernetes) provides a fully managed Kubernetes control plane with virtual nodes for serverless container workloads.</p>
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

## Compute Instances

OCI Compute instances use a **shape** model — the shape defines CPU, memory, network and storage characteristics. **Flexible shapes** (`.Flex`) allow you to tune vCPU and memory independently.

### Shape families

| Shape | Architecture | vCPU / Memory | Notes |
|-------|-------------|--------------|-------|
| **VM.Standard.E5.Flex** | AMD EPYC Genoa | 1–94 vCPU, 1–1049 GB | Most versatile general-purpose |
| **VM.Standard.A1.Flex** | Ampere Altra ARM | 1–80 vCPU, 1–512 GB | **Best price/performance**; Always Free tier |
| **VM.Standard3.Flex** | Intel Ice Lake | 1–32 vCPU, 1–512 GB | Intel-only workloads |
| **BM.Standard.E5.96** | AMD EPYC, bare-metal | 96 vCPU, 1024 GB | No hypervisor overhead |
| **VM.GPU.A10.1** | NVIDIA A10 GPU | 15 vCPU, 240 GB, 1× A10 | ML inference |

!!! tip "Ampere A1 Always Free"
    The OCI Always Free tier includes **4 Ampere A1 OCPUs and 24 GB RAM** perpetually — enough to run a small Kubernetes cluster or multiple microservices with zero cost. A1 instances also undercut other ARM cloud offerings by 30–50%.

### Instance configuration

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

### Instance Pools (autoscaling)

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

OKE is Oracle's managed Kubernetes service. The control plane is fully managed, multi-AD (Availability Domain) and zero-cost. You pay only for the worker nodes. OKE supports both managed nodes and **virtual nodes** (serverless).

### Node types

| Type | Description | Use case |
|------|-------------|---------|
| **Managed nodes** | VMs you provision in node pools; you manage OS patching | Standard workloads, GPU |
| **Virtual nodes** | Serverless pods — no VM management; OCI manages the infrastructure | Scale-to-zero, bursty workloads |
| **Self-managed nodes** | VMs you join manually | Custom OS, BYOK configurations |

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

OKE Workload Identity lets pods assume OCI IAM roles without Instance Principals or static credentials. Pods present an OIDC token; OCI IAM validates it and returns short-lived credentials.

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

OCI Container Instances are fully serverless containers — no cluster, no node pools. Ideal for short-lived jobs, CI steps, one-off tasks or staging environments that don't need a persistent cluster.

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

Oracle Functions is the OCI serverless compute service based on **Fn Project** (open-source). Functions are packaged as Docker images and triggered via HTTP, OCI Events, OCI Queues or Oracle Integration.

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

[← OCI Overview](index.md){ .md-button }
[Storage →](storage.md){ .md-button .md-button--primary }
