---
title: Azure Networking
description: VNet, Azure DNS, Front Door, App Gateway, ExpressRoute, Private Endpoint — rede no Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / networking</span>
    <h1 class="dph-title">Azure Networking</h1>
    <p class="dph-desc">Redes virtuais hub-spoke, gerenciamento global de tráfego com Front Door, balanceamento de carga granular com App Gateway, conectividade privada com Private Endpoint e rede híbrida com ExpressRoute — a rede Azure projetada para cargas de trabalho enterprise.</p>
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

Uma VNet é uma rede isolada de Camada 3 dentro de uma região do Azure. Diferentemente das VPCs da AWS, as VNets do Azure suportam **múltiplos espaços de endereço** e as sub-redes podem abranger todo o espaço de endereço da VNet.

### Topologia hub-spoke

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

NSGs são filtros de pacotes com estado aplicados a sub-redes ou NICs individuais. Defina regras com allow/deny, prioridade (100–4096, menor vence), intervalos de IP de origem/destino e portas.

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

Front Door é a rede global de entrega de aplicações do Azure — CDN, WAF, offload de SSL, roteamento anycast e failover baseado em saúde em um único serviço. **Front Door Standard/Premium** (geração atual) substitui a camada clássica e os perfis do Azure CDN.

```
Browser → Anycast POP (600+ globalmente)
            ├── Conteúdo em cache → servir imediatamente (CDN)
            └── Cache miss / dinâmico → roteie para a origem mais próxima e saudável
                  ├── Origem: App Service (primária)
                  └── Origem: Site estático (failover)
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
    Use **Front Door** para roteamento global entre múltiplas regiões, CDN e WAF anycast. Use **Application Gateway** para balanceamento de carga L7 regional dentro de uma VNet — ingress do AKS, roteamento por URL para microsserviços, terminação mTLS.

---

## Application Gateway

App Gateway é um balanceador de carga L7 regional e WAF. É o controlador de ingress padrão para AKS em ambientes Azure enterprise por meio do complemento **AGIC** (Application Gateway Ingress Controller).

### Recursos principais

| Recurso | Descrição |
|---------|-----------|
| **WAF v2** | Conjuntos de regras OWASP CRS 3.2, regras personalizadas, proteção contra bots |
| **Terminação SSL/TLS** | Offload de TLS, re-criptografia para o backend |
| **Roteamento por URL** | Rotear `/api/*` para pods de API, `/` para o frontend |
| **Afinidade de sessão por cookie** | Sessões sticky |
| **Escalonamento automático** | Mín 0 a máx N instâncias (SKU v2) |
| **Private link** | Expor o App Gateway privadamente entre VNets |

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
  # ... pool de backend, configurações http, regras de roteamento omitidos por brevidade
}
```

---

## Private Endpoint

Private Endpoint atribui um endereço IP privado na sua VNet a um serviço PaaS do Azure (Storage, Key Vault, ACR, servidor de API do AKS, SQL, etc.) — o tráfego permanece no backbone da Microsoft, sem passar pela internet.

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

!!! tip "Zonas de DNS Privado"
    Cada serviço PaaS do Azure tem sua própria zona DNS `privatelink.*`. Vincule essas zonas a todas as VNets que precisam resolver endpoints privados. Centralize as Zonas de DNS Privado na VNet hub e vincule os spokes — evita duplicar zonas por spoke.

---

## Azure DNS

Azure DNS hospeda zonas DNS com roteamento anycast e disponibilidade com SLA de 100%. Use **Zonas de DNS Privado** para resolução de nomes internos entre serviços dentro de VNets.

| Tipo de zona | Resolvido por | Caso de uso |
|--------------|---------------|-------------|
| **DNS Público** | Resolvedores da internet | Domínios voltados ao público externo |
| **DNS Privado** | Resolvedores internos do Azure | Descoberta de serviços dentro da VNet |

---

## ExpressRoute & VPN Gateway

| Opção | Largura de banda | Latência | Custo | Caso de uso |
|-------|-----------------|---------|-------|-------------|
| **ExpressRoute** | 50 Mbps – 100 Gbps | Baixa, previsível | Alto | Conectividade híbrida em produção |
| **VPN Gateway** | Até 10 Gbps | Variável | Menor | Dev/teste, caminho de backup, filiais |
| **ExpressRoute + VPN** | Combinado | Redundante | Maior | HA híbrido com ExpressRoute como primário |

---

[← Visão Geral Azure](index.md){ .md-button }
[Segurança & IAM →](security.md){ .md-button .md-button--primary }
