---
title: OCI Rede
description: VCN, Load Balancer, Network Firewall, FastConnect, Service Gateway — rede na Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / networking</span>
    <h1 class="dph-title">OCI Rede</h1>
    <p class="dph-desc">A Virtual Cloud Network (VCN) da OCI é sua rede privada dentro de uma região. Security Lists e Network Security Groups controlam o tráfego. O Load Balancer de forma flexível lida com L4 e L7. O FastConnect fornece conectividade privada dedicada à OCI.</p>
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

Uma VCN é uma rede definida por software em uma única região OCI. Ao contrário da AWS/GCP, as VCNs da OCI suportam até 5 blocos CIDR não sobrepostos. As sub-redes podem ser **regionais** (abrangendo todos os ADs) ou específicas de AD. Use sub-redes regionais para novas implantações.

### Topologia de rede

```
VCN (10.0.0.0/16)
  ├── Sub-rede Pública (10.0.0.0/24)     → Internet Gateway → Internet
  │     └── Load Balancer, Bastion
  ├── Sub-rede App Privada (10.0.10.0/24) → NAT Gateway → Internet (saída)
  │     └── Nós worker OKE, Instâncias de App
  ├── Sub-rede Dados Privada (10.0.20.0/24)
  │     └── Bancos de dados, Vault
  └── Service Gateway → Serviços OCI (Object Storage, etc.)
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
| **Aplicado a** | Sub-rede (todos os VNICs na sub-rede) | VNICs individuais ou backends de LB |
| **Direção** | Regras de entrada e saída | Entrada e saída |
| **Granularidade** | Grosseira — nível de sub-rede | Refinada — nível por recurso |
| **NSG como origem** | Não | Sim — referencia outro NSG como origem |
| **Recomendação** | Mínimo: permitir tudo dentro da sub-rede | Principal: regras granulares por recurso |

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

O Load Balancer gerenciado da OCI suporta tanto L4 (TCP/UDP) quanto L7 (HTTP/HTTPS) no mesmo recurso usando uma **forma flexível** — você define a largura de banda mínima e máxima em vez de selecionar um tamanho fixo.

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

O OCI Network Firewall é um firewall de próxima geração gerenciado baseado na tecnologia Palo Alto Networks. Ele fornece inspeção profunda de pacotes, filtragem de URL, IDS/IPS e filtragem na camada de aplicação para tráfego VCN.

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

O FastConnect é o serviço de conectividade privada dedicada da OCI — análogo ao AWS Direct Connect ou Azure ExpressRoute. Ele fornece largura de banda determinística, menor latência e sem trânsito pela internet.

| Opção | Velocidade | Caso de uso |
|-------|-----------|-------------|
| **FastConnect Partner** | 1–10 Gbps | Acesso via parceiro de co-localização (Equinix, Megaport) |
| **FastConnect Direct** | 10 ou 100 Gbps | Cross-connect direto nas instalações de co-localização Oracle |

### Dynamic Routing Gateway (DRG)

O DRG é o hub para toda conectividade externa — FastConnect, VPN Site-a-Site e peering de VCN. Anexe múltiplas VCNs a um único DRG e roteie entre elas sem limites de peering de VCN.

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

O Service Gateway fornece conectividade privada de recursos VCN para serviços públicos OCI (Object Storage, OCI Registry, Vault, Monitoring, etc.) sem passar pela internet. O tráfego permanece no backbone da Oracle.

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

[← Visão Geral OCI](index.md){ .md-button }
[Segurança & IAM →](security.md){ .md-button .md-button--primary }
