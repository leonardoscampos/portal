---
title: GCP Networking
description: VPC, Cloud DNS, Cloud CDN, Cloud Load Balancing, Cloud NAT, Cloud Interconnect — GCP networking.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// gcp / networking</span>
    <h1 class="dph-title">GCP Networking</h1>
    <p class="dph-desc">GCP's global VPC is unique — a single VPC spans all regions worldwide with no VPC peering required. Cloud Load Balancing is anycast by default. Cloud NAT, Private Service Connect and Cloud Interconnect complete the enterprise networking stack.</p>
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

## VPC & Subnets

GCP VPCs are **global** — a single VPC has subnets in every region. This is fundamentally different from AWS/Azure where VPCs/VNets are regional. GCP uses **primary** and **secondary** IP ranges per subnet — secondary ranges are required for GKE pod and service IPs.

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

### Firewall rules

GCP firewalls are applied at the **network level**, not subnet/interface level. Rules are either **ingress** or **egress** with a priority (0–65534, lower wins) and target by tag or service account.

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

!!! tip "Service account-based firewall rules"
    Prefer **service account** targets over network tags in production. Tags are manually assigned and can be accidentally removed; service accounts are bound to the VM identity and cannot be spoofed.

---

## Cloud Load Balancing

GCP's load balancers are globally anycast by default — a single external IP serves all regions worldwide. GCP routes each request to the closest healthy backend.

### Load balancer types

| Type | Scope | Protocol | Use case |
|------|-------|---------|---------|
| **Global External ALB** | Global | HTTP/HTTPS | Public web apps, APIs, CDN + WAF |
| **Regional External ALB** | Regional | HTTP/HTTPS | Single-region apps |
| **Global External NLB** (Passthrough) | Global | TCP/UDP | Non-HTTP, preserves client IP |
| **Regional External NLB** | Regional | TCP/UDP | Regional passthrough LB |
| **Internal ALB** | Regional | HTTP/HTTPS | Service mesh, internal APIs |
| **Internal NLB** | Regional | TCP/UDP | Internal databases, services |

### Global HTTPS load balancer

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

Cloud NAT provides outbound internet access for VMs without external IP addresses. It is software-defined — no VMs to manage, automatic scaling.

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

Private Service Connect (PSC) is the GCP equivalent of AWS PrivateLink. It allows consumers to access Google APIs and managed services (Cloud SQL, GCS, PubSub, etc.) or producer services via a private IP in the consumer VPC — no external egress.

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

Cloud DNS is Google's managed DNS service with 100% uptime SLA and global anycast distribution. Supports public and private zones, DNSSEC, and DNS peering between VPCs.

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

| Option | Bandwidth | Latency | SLA | Use case |
|--------|----------|--------|-----|---------|
| **Dedicated Interconnect** | 10–200 Gbps per circuit | Low, predictable | 99.99% | High-bandwidth enterprise |
| **Partner Interconnect** | 50 Mbps – 50 Gbps | Low | 99.9–99.99% | Access without 10G ports |
| **HA VPN** | Up to 3 Gbps per tunnel | Variable | 99.99% | Lower-cost hybrid, encryption |

!!! tip "99.99% Interconnect SLA"
    To qualify for the 99.99% SLA on Dedicated or Partner Interconnect, you must configure **4 VLAN attachments** (2 per metro, 2 metros) with Cloud Routers in 2 regions. Single-circuit configurations only qualify for the 99.9% SLA.

---

[← GCP Overview](index.md){ .md-button }
[Security & IAM →](security.md){ .md-button .md-button--primary }
