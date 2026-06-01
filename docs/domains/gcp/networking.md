---
title: GCP Rede
description: VPC, Cloud DNS, Cloud CDN, Cloud Load Balancing, Cloud NAT, Cloud Interconnect — rede no Google Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / networking</span>
    <h1 class="dph-title">GCP Rede</h1>
    <p class="dph-desc">A VPC global do GCP é única — uma única VPC abrange todas as regiões do mundo sem necessidade de peering entre VPCs. O Cloud Load Balancing é anycast por padrão. Cloud NAT, Private Service Connect e Cloud Interconnect completam a pilha de rede corporativa.</p>
    <div class="dph-badges">
      <span class="tech-badge">Global VPC</span>
      <span class="tech-badge">Cloud DNS</span>
      <span class="tech-badge">Cloud CDN</span>
      <span class="tech-badge">Cloud LB</span>
      <span class="tech-badge">Cloud NAT</span>
      <span class="tech-badge">Cloud Interconnect</span>
    </div>
  </div>
</div>

---

## VPC & Sub-redes

As VPCs do GCP são **globais** — uma única VPC possui sub-redes em todas as regiões. Isso é fundamentalmente diferente da AWS/Azure, onde VPCs/VNets são regionais. O GCP usa intervalos de IP **primários** e **secundários** por sub-rede — os intervalos secundários são necessários para IPs de pods e serviços do GKE.

```hcl
resource "google_compute_network" "main" {
  name                    = "${var.project}-vpc"
  auto_create_subnetworks = false  # always false for custom subnets
  routing_mode            = "GLOBAL"  # enables global dynamic routing for VPN/Interconnect
}

resource "google_compute_subnetwork" "gke" {
  name          = "${var.project}-gke-${var.region}"
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = "10.10.0.0/20"    # node IPs

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/16"  # pod IPs (up to 65536)
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.30.0.0/20"  # service IPs
  }

  private_ip_google_access = true   # pods reach Google APIs without external IPs
  log_config { aggregation_interval = "INTERVAL_5_SEC"; flow_sampling = 0.5 }
}
```

### Regras de Firewall

Os Firewalls do GCP são aplicados no **nível da rede**, não no nível de sub-rede/interface. As regras são de **entrada** (ingress) ou **saída** (egress) com uma prioridade (0–65534, menor vence) e alvo por tag ou conta de serviço.

```hcl
resource "google_compute_firewall" "allow_internal" {
  name    = "${var.project}-allow-internal"
  network = google_compute_network.main.name

  allow { protocol = "tcp"; ports = ["0-65535"] }
  allow { protocol = "udp"; ports = ["0-65535"] }
  allow { protocol = "icmp" }

  source_ranges = ["10.0.0.0/8"]
  priority      = 1000
}

resource "google_compute_firewall" "allow_health_check" {
  name    = "${var.project}-allow-lb-health-check"
  network = google_compute_network.main.name

  allow { protocol = "tcp" }

  # Google health checker ranges
  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  target_tags   = ["backend"]
  priority      = 900
}
```

!!! tip "Regras de Firewall baseadas em conta de serviço"
    Prefira alvos de **conta de serviço** a tags de rede em produção. As tags são atribuídas manualmente e podem ser removidas acidentalmente; as contas de serviço estão vinculadas à identidade da VM e não podem ser falsificadas.

---

## Cloud Load Balancing

Os Load Balancers do GCP são anycast globalmente por padrão — um único IP externo atende todas as regiões do mundo. O GCP roteia cada solicitação para o backend saudável mais próximo.

### Tipos de Load Balancer

| Tipo | Escopo | Protocolo | Caso de uso |
|------|--------|-----------|-------------|
| **Global External ALB** | Global | HTTP/HTTPS | Aplicações web públicas, APIs, CDN + WAF |
| **Regional External ALB** | Regional | HTTP/HTTPS | Aplicações de região única |
| **Global External NLB** (Passthrough) | Global | TCP/UDP | Não-HTTP, preserva IP do cliente |
| **Regional External NLB** | Regional | TCP/UDP | Load Balancer de passthrough regional |
| **Internal ALB** | Regional | HTTP/HTTPS | Service mesh, APIs internas |
| **Internal NLB** | Regional | TCP/UDP | Bancos de dados internos, serviços |

### Load Balancer HTTPS Global

```hcl
# Compute target
resource "google_compute_backend_service" "app" {
  name                  = "${var.project}-backend"
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 30
  health_checks         = [google_compute_health_check.app.id]

  backend {
    group           = google_compute_region_instance_group_manager.app.instance_group
    balancing_mode  = "UTILIZATION"
    capacity_scaler = 1.0
  }

  log_config { enable = true; sample_rate = 0.01 }

  cdn_policy {
    cache_mode = "CACHE_ALL_STATIC"
    default_ttl = 3600
    client_ttl  = 7200
  }
}

resource "google_compute_url_map" "app" {
  name            = "${var.project}-url-map"
  default_service = google_compute_backend_service.app.id
}

resource "google_compute_target_https_proxy" "app" {
  name             = "${var.project}-https-proxy"
  url_map          = google_compute_url_map.app.id
  ssl_certificates = [google_compute_managed_ssl_certificate.app.id]
}

resource "google_compute_global_forwarding_rule" "app" {
  name                  = "${var.project}-forwarding-rule"
  target                = google_compute_target_https_proxy.app.id
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.app.address
}
```

---

## Cloud NAT

O Cloud NAT fornece acesso à internet de saída para VMs sem endereços IP externos. É definido por software — sem VMs para gerenciar, escalonamento automático.

```hcl
resource "google_compute_router" "main" {
  name    = "${var.project}-router"
  region  = var.region
  network = google_compute_network.main.id
}

resource "google_compute_router_nat" "main" {
  name                               = "${var.project}-nat"
  router                             = google_compute_router.main.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
```

---

## Private Service Connect

O Private Service Connect (PSC) é o equivalente GCP do AWS PrivateLink. Permite que os consumidores acessem as APIs do Google e serviços gerenciados (Cloud SQL, GCS, PubSub, etc.) ou serviços de produtores via um IP privado na VPC do consumidor — sem egresso externo.

```hcl
# PSC endpoint for accessing Google APIs privately
resource "google_compute_global_address" "psc" {
  name         = "psc-google-apis"
  address_type = "INTERNAL"
  purpose      = "PRIVATE_SERVICE_CONNECT"
  network      = google_compute_network.main.id
  address      = "10.100.0.2"
}

resource "google_compute_global_forwarding_rule" "psc" {
  name                  = "psc-google-apis"
  target                = "all-apis"         # routes to all Google APIs
  network               = google_compute_network.main.id
  ip_address            = google_compute_global_address.psc.id
  load_balancing_scheme = ""
}
```

---

## Cloud DNS

Cloud DNS é o serviço DNS gerenciado do Google com SLA de 100% de uptime e distribuição anycast global. Suporta zonas públicas e privadas, DNSSEC e peering de DNS entre VPCs.

```hcl
resource "google_dns_managed_zone" "public" {
  name        = "${var.project}-public"
  dns_name    = "${var.domain}."
  description = "Public DNS zone for ${var.domain}"

  dnssec_config { state = "on" }

  cloud_logging_config { enable_logging = true }
}

resource "google_dns_record_set" "app" {
  name         = "app.${var.domain}."
  managed_zone = google_dns_managed_zone.public.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.app.address]
}
```

---

## Cloud Interconnect & VPN

| Opção | Largura de banda | Latência | SLA | Caso de uso |
|-------|-----------------|---------|-----|-------------|
| **Dedicated Interconnect** | 10–200 Gbps por circuito | Baixa, previsível | 99,99% | Corporativo de alta largura de banda |
| **Partner Interconnect** | 50 Mbps – 50 Gbps | Baixa | 99,9–99,99% | Acesso sem portas 10G |
| **HA VPN** | Até 3 Gbps por túnel | Variável | 99,99% | Híbrido de menor custo, criptografia |

!!! tip "SLA 99,99% do Interconnect"
    Para se qualificar para o SLA de 99,99% no Dedicated ou Partner Interconnect, você deve configurar **4 anexos de VLAN** (2 por metrô, 2 metrôs) com Cloud Routers em 2 regiões. Configurações de circuito único se qualificam apenas para o SLA de 99,9%.

---

[← Visão Geral GCP](index.md){ .md-button }
[Segurança & IAM →](security.md){ .md-button .md-button--primary }
