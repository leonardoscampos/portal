---
title: OCI Networking
description: VCN, Load Balancer, Network Firewall, FastConnect, Service Gateway — networking on Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / networking</span>
    <h1 class="dph-title">OCI Networking</h1>
    <p class="dph-desc">OCI's Virtual Cloud Network (VCN) is your private network within a region. Security Lists and Network Security Groups control traffic. The flexible-shape Load Balancer handles L4 and L7. FastConnect provides dedicated private connectivity to OCI.</p>
    <div class="dph-badges">
      <span class="tech-badge">VCN</span>
      <span class="tech-badge">Load Balancer</span>
      <span class="tech-badge">Network Firewall</span>
      <span class="tech-badge">FastConnect</span>
      <span class="tech-badge">Service Gateway</span>
      <span class="tech-badge">DNS</span>
    </div>
  </div>
</div>

---

## Virtual Cloud Network (VCN)

A VCN is a software-defined network in a single OCI region. Unlike AWS/GCP, OCI VCNs support up to 5 non-overlapping CIDR blocks. Subnets can be **regional** (spanning all ADs) or AD-specific. Use regional subnets for new deployments.

### Network topology

```
VCN (10.0.0.0/16)
  ├── Public Subnet (10.0.0.0/24)     → Internet Gateway → Internet
  │     └── Load Balancer, Bastion
  ├── Private App Subnet (10.0.10.0/24) → NAT Gateway → Internet (outbound)
  │     └── OKE worker nodes, App instances
  ├── Private Data Subnet (10.0.20.0/24)
  │     └── Databases, Vault
  └── Service Gateway → OCI Services (Object Storage, etc.)
```

```hcl
resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_id
  cidr_blocks    = ["10.0.0.0/16"]
  display_name   = "${var.project}-vcn"
  dns_label      = var.project
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  enabled        = true
  display_name   = "${var.project}-igw"
}

resource "oci_core_nat_gateway" "main" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.project}-nat"
  block_traffic  = false
}

resource "oci_core_service_gateway" "main" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.project}-sgw"
  services {
    service_id = data.oci_core_services.all.services[0].id  # all OCI services
  }
}

resource "oci_core_subnet" "private_app" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = "10.0.10.0/24"
  display_name               = "${var.project}-private-app"
  prohibit_public_ip_on_vnic = true   # private subnet
  dns_label                  = "appsubnet"
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.private_app.id]
}
```

### Security Lists vs Network Security Groups

| | Security List | Network Security Group (NSG) |
|-|--------------|------------------------------|
| **Applied to** | Subnet (all VNICs in subnet) | Individual VNICs or LB backends |
| **Direction** | Both ingress and egress rules | Both ingress and egress |
| **Granularity** | Coarse — subnet level | Fine — per-resource level |
| **NSG-as-source** | No | Yes — reference another NSG as source |
| **Recommendation** | Minimal: allow-all within subnet | Primary: granular per-resource rules |

```hcl
resource "oci_core_network_security_group" "app" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.project}-app-nsg"
}

resource "oci_core_network_security_group_security_rule" "app_https_ingress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6"  # TCP
  source                    = oci_core_network_security_group.lb.id
  source_type               = "NETWORK_SECURITY_GROUP"

  tcp_options {
    destination_port_range { min = 8080; max = 8080 }
  }
}

resource "oci_core_network_security_group_security_rule" "app_egress" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "EGRESS"
  protocol                  = "all"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
}
```

---

## Load Balancer

OCI's managed Load Balancer supports both L4 (TCP/UDP) and L7 (HTTP/HTTPS) on the same resource using a **flexible shape** — you define minimum and maximum bandwidth rather than selecting a fixed size.

```hcl
resource "oci_load_balancer_load_balancer" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-lb"
  shape          = "flexible"
  subnet_ids     = [oci_core_subnet.public.id]
  is_private     = false
  network_security_group_ids = [oci_core_network_security_group.lb.id]

  shape_details {
    minimum_bandwidth_in_mbps = 10
    maximum_bandwidth_in_mbps = 400
  }
}

resource "oci_load_balancer_backend_set" "app" {
  load_balancer_id = oci_load_balancer_load_balancer.main.id
  name             = "app-backend-set"
  policy           = "LEAST_CONNECTIONS"

  health_checker {
    protocol            = "HTTP"
    port                = 8080
    url_path            = "/health"
    interval_ms         = 10000
    timeout_in_millis   = 3000
    retries             = 3
    return_code         = 200
  }
}

resource "oci_load_balancer_listener" "https" {
  load_balancer_id         = oci_load_balancer_load_balancer.main.id
  name                     = "https-listener"
  default_backend_set_name = oci_load_balancer_backend_set.app.name
  port                     = 443
  protocol                 = "HTTP2"

  ssl_configuration {
    certificate_name        = oci_load_balancer_certificate.app.certificate_name
    verify_peer_certificate = false
    protocols               = ["TLSv1.2", "TLSv1.3"]
  }
}
```

---

## Network Firewall

OCI Network Firewall is a managed next-generation firewall based on Palo Alto Networks technology. It provides deep packet inspection, URL filtering, IDS/IPS, and application-layer filtering for VCN traffic.

```hcl
resource "oci_network_firewall_network_firewall_policy" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-nfw-policy"

  security_rules {
    name   = "allow-web-outbound"
    action = "ALLOW"
    condition {
      application = ["http", "https"]
      destination_address = ["0.0.0.0/0"]
    }
  }

  security_rules {
    name   = "deny-all"
    action = "REJECT"
    condition {}
  }
}

resource "oci_network_firewall_network_firewall" "main" {
  compartment_id                = var.compartment_id
  display_name                  = "${var.project}-nfw"
  subnet_id                     = oci_core_subnet.firewall.id
  network_firewall_policy_id    = oci_network_firewall_network_firewall_policy.main.id
  availability_domain           = data.oci_identity_availability_domains.ads.availability_domains[0].name
}
```

---

## FastConnect

FastConnect is OCI's dedicated private connectivity service — analogous to AWS Direct Connect or Azure ExpressRoute. It provides deterministic bandwidth, lower latency and no internet transit.

| Option | Speed | Use case |
|--------|-------|---------|
| **FastConnect Partner** | 1–10 Gbps | Access via a co-location partner (Equinix, Megaport) |
| **FastConnect Direct** | 10 or 100 Gbps | Direct cross-connect in Oracle co-location facilities |

### Dynamic Routing Gateway (DRG)

The DRG is the hub for all external connectivity — FastConnect, Site-to-Site VPN and VCN peering. Attach multiple VCNs to a single DRG and route between them without VCN peering limits.

```hcl
resource "oci_core_drg" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-drg"
}

resource "oci_core_drg_attachment" "vcn" {
  drg_id = oci_core_drg.main.id
  vcn_id = oci_core_vcn.main.id
}
```

---

## Service Gateway

The Service Gateway provides private connectivity from VCN resources to OCI public services (Object Storage, OCI Registry, Vault, Monitoring, etc.) without traversing the internet. Traffic stays on the Oracle backbone.

```hcl
resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.project}-private-rt"

  route_rules {
    # OCI services via Service Gateway (no internet)
    network_entity_id = oci_core_service_gateway.main.id
    destination       = data.oci_core_services.all.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
  }

  route_rules {
    # Internet access via NAT Gateway
    network_entity_id = oci_core_nat_gateway.main.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}
```

---

[← OCI Overview](index.md){ .md-button }
[Security & IAM →](security.md){ .md-button .md-button--primary }
