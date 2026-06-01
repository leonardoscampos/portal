---
title: Azure Networking
description: VNet, Azure DNS, Front Door, App Gateway, ExpressRoute, Private Endpoint — networking on Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / networking</span>
    <h1 class="dph-title">Azure Networking</h1>
    <p class="dph-desc">Hub-spoke virtual networks, global traffic management with Front Door, granular load balancing with App Gateway, private connectivity with Private Endpoint and hybrid networking with ExpressRoute — Azure networking designed for enterprise workloads.</p>
    <div class="dph-badges">
      <span class="tech-badge">VNet</span>
      <span class="tech-badge">Azure DNS</span>
      <span class="tech-badge">Front Door</span>
      <span class="tech-badge">App Gateway</span>
      <span class="tech-badge">ExpressRoute</span>
      <span class="tech-badge">Private Endpoint</span>
    </div>
  </div>
</div>

---

## Virtual Network (VNet)

A VNet is an isolated Layer-3 network within an Azure region. Unlike AWS VPCs, Azure VNets support **multiple address spaces** and subnets can span the entire address space of the VNet.

### Hub-spoke topology

```
   On-premises ─── ExpressRoute/VPN ──→ Hub VNet
                                           │
               ┌───────────────────────────┤
               ↓                           ↓
          Spoke: Prod                 Spoke: Dev
          (AKS, App, DB)             (Dev workloads)
```

```hcl
module "hub_vnet" {
  source  = "Azure/avm-res-network-virtualnetwork/azurerm"
  version = "~> 0.4"

  name                = "hub-vnet"
  resource_group_name = azurerm_resource_group.networking.name
  location            = var.location
  address_space       = ["10.0.0.0/16"]

  subnets = {
    AzureFirewallSubnet = { address_prefixes = ["10.0.0.0/26"] }
    GatewaySubnet       = { address_prefixes = ["10.0.1.0/27"] }
    AzureBastionSubnet  = { address_prefixes = ["10.0.2.0/27"] }
  }
}

module "spoke_prod" {
  source  = "Azure/avm-res-network-virtualnetwork/azurerm"
  version = "~> 0.4"

  name                = "spoke-prod-vnet"
  resource_group_name = azurerm_resource_group.prod.name
  location            = var.location
  address_space       = ["10.10.0.0/16"]

  subnets = {
    aks      = { address_prefixes = ["10.10.0.0/22"] }
    database = { address_prefixes = ["10.10.8.0/24"] }
  }
}

resource "azurerm_virtual_network_peering" "hub_to_spoke" {
  name                      = "hub-to-spoke-prod"
  resource_group_name       = azurerm_resource_group.networking.name
  virtual_network_name      = module.hub_vnet.name
  remote_virtual_network_id = module.spoke_prod.resource_id
  allow_forwarded_traffic   = true
  allow_gateway_transit     = true
}
```

### Network Security Groups

NSGs are stateful packet filters applied to subnets or individual NICs. Define rules with allow/deny, priority (100–4096, lower wins), source/dest IP ranges and ports.

```hcl
resource "azurerm_network_security_group" "aks" {
  name                = "aks-nsg"
  resource_group_name = azurerm_resource_group.prod.name
  location            = var.location

  security_rule {
    name                       = "allow-https-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}
```

---

## Azure Front Door

Front Door is Azure's global application delivery network — CDN, WAF, SSL offload, anycast routing and health-based failover in one service. **Front Door Standard/Premium** (the current generation) replaces the classic tier and Azure CDN profiles.

```
Browser → Anycast POP (600+ globally)
            ├── Cached content → serve immediately (CDN)
            └── Cache miss / dynamic → route to closest healthy origin
                  ├── Origin: App Service (primary)
                  └── Origin: Static Website (failover)
```

```hcl
resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "${var.project}-afd"
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Premium_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_endpoint" "app" {
  name                     = "${var.project}-endpoint"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
}

resource "azurerm_cdn_frontdoor_origin_group" "app" {
  name                     = "app-origin-group"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  health_probe {
    interval_in_seconds = 30
    path                = "/health"
    protocol            = "Https"
    request_type        = "GET"
  }

  load_balancing {
    additional_latency_in_milliseconds = 50
    sample_size                        = 4
    successful_samples_required        = 3
  }
}
```

!!! tip "Front Door vs App Gateway"
    Use **Front Door** for global multi-region routing, CDN and anycast WAF. Use **Application Gateway** for regional L7 load balancing within a VNet — AKS ingress, URL-path routing to microservices, mTLS termination.

---

## Application Gateway

App Gateway is a regional L7 load balancer and WAF. It is the standard ingress controller for AKS in enterprise Azure environments via the **AGIC** (Application Gateway Ingress Controller) add-on.

### Key features

| Feature | Description |
|---------|-------------|
| **WAF v2** | OWASP CRS 3.2 rule sets, custom rules, bot protection |
| **SSL/TLS termination** | Offload TLS, re-encrypt to backend |
| **URL-based routing** | Route `/api/*` to API pods, `/` to frontend |
| **Cookie-based session affinity** | Sticky sessions |
| **Autoscaling** | Min 0 to max N instances (v2 SKU) |
| **Private link** | Expose App Gateway privately across VNets |

```hcl
resource "azurerm_application_gateway" "main" {
  name                = "${var.project}-agw"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location

  sku { name = "WAF_v2"; tier = "WAF_v2" }
  autoscale_configuration { min_capacity = 1; max_capacity = 10 }

  waf_configuration {
    enabled          = true
    firewall_mode    = "Prevention"
    rule_set_version = "3.2"
  }

  gateway_ip_configuration {
    name      = "main"
    subnet_id = azurerm_subnet.agw.id
  }

  frontend_ip_configuration {
    name                 = "public"
    public_ip_address_id = azurerm_public_ip.agw.id
  }

  frontend_port { name = "https"; port = 443 }

  ssl_certificate {
    name                = "app-cert"
    key_vault_secret_id = azurerm_key_vault_certificate.app.secret_id
  }
  # ... backend pool, http settings, routing rules omitted for brevity
}
```

---

## Private Endpoint

Private Endpoint gives a private IP address in your VNet to an Azure PaaS service (Storage, Key Vault, ACR, AKS API server, SQL, etc.) — traffic stays on the Microsoft backbone, never traversing the internet.

```hcl
resource "azurerm_private_endpoint" "keyvault" {
  name                = "kv-pe"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "kv-connection"
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "kv-dns-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.keyvault.id]
  }
}

resource "azurerm_private_dns_zone" "keyvault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.networking.name
}
```

!!! tip "Private DNS Zones"
    Each Azure PaaS service has its own `privatelink.*` DNS zone. Link these zones to every VNet that needs to resolve private endpoints. Centralise Private DNS Zones in the hub VNet and link spokes — avoids duplicating zones per spoke.

---

## Azure DNS

Azure DNS hosts DNS zones with anycast routing and 100% SLA availability. Use **Private DNS Zones** for internal service-to-service name resolution within VNets.

| Zone type | Resolved by | Use case |
|-----------|------------|---------|
| **Public DNS** | Internet resolvers | External-facing domains |
| **Private DNS** | Azure-internal resolvers | VNet-internal service discovery |

---

## ExpressRoute & VPN Gateway

| Option | Bandwidth | Latency | Cost | Use case |
|--------|----------|--------|------|---------|
| **ExpressRoute** | 50 Mbps – 100 Gbps | Low, predictable | High | Production hybrid connectivity |
| **VPN Gateway** | Up to 10 Gbps | Variable | Lower | Dev/test, backup path, branch offices |
| **ExpressRoute + VPN** | Combined | Redundant | Higher | HA hybrid with ExpressRoute as primary |

---

[← Azure Overview](index.md){ .md-button }
[Security & IAM →](security.md){ .md-button .md-button--primary }
