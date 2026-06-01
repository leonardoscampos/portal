---
title: AWS Rede
description: VPC, Route 53, CloudFront, ALB/NLB, Transit Gateway — fundamentos de rede na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / networking</span>
    <h1 class="dph-title">AWS Rede</h1>
    <p class="dph-desc">Redes privadas, DNS global, entrega de conteúdo no edge, balanceamento de carga e conectividade híbrida. A rede AWS é a fundação sobre a qual toda carga de trabalho em nuvem é construída — acertar o design desde o início evita retrabalho significativo no futuro.</p>
    <div class="dph-badges">
      <span class="tech-badge">VPC</span>
      <span class="tech-badge">Route 53</span>
      <span class="tech-badge">CloudFront</span>
      <span class="tech-badge">ALB</span>
      <span class="tech-badge">NLB</span>
      <span class="tech-badge">Transit GW</span>
      <span class="tech-badge">PrivateLink</span>
    </div>
  </div>
</div>

---

## VPC — Virtual Private Cloud

Uma VPC é uma rede virtual isolada dentro de uma região. Toda carga de trabalho em produção começa aqui — acerte o design de CIDR antes de criar qualquer outra coisa.

### Design de sub-redes

| Tipo de sub-rede | Tabela de rotas | Uso típico |
|-----------------|----------------|------------|
| **Pública** | → Internet Gateway | Load balancers, NAT Gateways, bastion hosts |
| **Privada** | → NAT Gateway | Servidores de app, nodes EKS, tasks ECS, bancos de dados |
| **Isolada** | Somente local | RDS, ElastiCache, serviços internos sem necessidade de internet |

!!! tip "Planejamento de CIDR"
    Use `/16` por VPC (65.534 IPs) e aloque sub-redes `/24` por AZ por camada (fornece 254 hosts cada). Reserve o último bloco `/24` em cada camada para AZs futuras. Evite `10.0.0.0/8` se planeja fazer peering com redes on-prem que já o utilizam — use `100.64.0.0/10` (IANA Shared Address Space) para tráfego interno à VPC.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.project}-${var.env}"
  cidr = "10.20.0.0/16"

  azs              = ["${var.region}a", "${var.region}b", "${var.region}c"]
  private_subnets  = ["10.20.1.0/24", "10.20.2.0/24", "10.20.3.0/24"]
  public_subnets   = ["10.20.101.0/24", "10.20.102.0/24", "10.20.103.0/24"]
  database_subnets = ["10.20.201.0/24", "10.20.202.0/24", "10.20.203.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false  # um NAT por AZ para HA
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Tags necessárias para EKS
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }
}
```

### VPC Endpoints

Os VPC Endpoints permitem acesso privado aos serviços AWS sem passar pela internet ou pelo NAT Gateway, reduzindo custo de egresso e latência.

| Tipo | Exemplos | Custo |
|------|---------|-------|
| **Gateway** | S3, DynamoDB | Gratuito |
| **Interface** (PrivateLink) | ECR, Secrets Manager, SSM, KMS, CloudWatch | ~$0,01/h/AZ |

```hcl
# Endpoint Gateway para S3 (gratuito — sempre crie este)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
}
```

### VPC Flow Logs

Habilite Flow Logs em toda VPC de produção. Envie para S3 para retenção de longo prazo com baixo custo; consulte com Athena. Envie para CloudWatch Logs para alertas em tempo real.

---

## Route 53

O Route 53 é o serviço gerenciado de DNS e verificação de saúde da AWS. Suporta tanto **zonas hospedadas públicas** (resolúveis pela internet) quanto **zonas hospedadas privadas** (internas à VPC).

### Políticas de roteamento

| Política | Caso de uso |
|----------|-------------|
| **Simple** | Recurso único, sem verificação de saúde |
| **Weighted** | Deploys A/B, distribuição de tráfego entre origens |
| **Latency** | Roteia para a região com menor latência |
| **Failover** | DR ativo/passivo — primário + secundário com verificação de saúde |
| **Geolocation** | Conformidade, localização de conteúdo |
| **Geoproximity** | Engenharia de tráfego com ajuste de bias |
| **Multivalue** | Até 8 registros saudáveis retornados (não substitui um load balancer) |

```hcl
# Zona hospedada privada para DNS entre serviços
resource "aws_route53_zone" "internal" {
  name = "${var.env}.internal.example.com"

  vpc {
    vpc_id = module.vpc.vpc_id
  }
}

# Roteamento ponderado para deploy canário
resource "aws_route53_record" "api_v1" {
  zone_id = aws_route53_zone.public.zone_id
  name    = "api.example.com"
  type    = "A"

  alias {
    name                   = aws_lb.v1.dns_name
    zone_id                = aws_lb.v1.zone_id
    evaluate_target_health = true
  }

  weighted_routing_policy { weight = 90 }
  set_identifier = "v1"
}
```

---

## CloudFront

O CloudFront é a CDN global da AWS com mais de 600 locais de edge. Faz cache de conteúdo próximo aos usuários e integra-se com WAF, ACM (TLS gratuito), Lambda@Edge e CloudFront Functions.

### Anatomia de uma distribuição

```
Navegador → CloudFront Edge
           ├── Cache hit → serve imediatamente
           └── Cache miss → encaminha para a Origem
                             ├── S3 (assets estáticos, SPA)
                             ├── ALB (API dinâmica)
                             └── Origem HTTP personalizada
```

```hcl
resource "aws_cloudfront_distribution" "portal" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = ["portal.example.com"]

  origin {
    domain_name              = aws_s3_bucket.portal.bucket_regional_domain_name
    origin_id                = "s3-portal"
    origin_access_control_id = aws_cloudfront_origin_access_control.portal.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-portal"
    viewer_protocol_policy = "redirect-to-https"
    cached_methods         = ["GET", "HEAD"]
    allowed_methods        = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.cors_s3.id
  }

  restrictions { geo_restriction { restriction_type = "none" } }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.portal.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
```

!!! tip "CloudFront Functions vs Lambda@Edge"
    **CloudFront Functions** executam no edge (sub-ms, 1/6 do custo) para reescritas simples de URL, manipulação de headers e validação de tokens de autenticação. **Lambda@Edge** executa nos Regional Edge Caches com Node.js/Python completo e timeout de até 30 segundos — use para fluxos OAuth, testes A/B e personalização dinâmica.

---

## ALB & NLB

### Application Load Balancer (ALB) — Camada 7

O ALB roteia tráfego HTTP/HTTPS com base em **regras**: header do host, caminho, query string, método HTTP, IP de origem ou headers HTTP. Cada regra aponta para um **Target Group** (instâncias EC2, tasks ECS por IP, Lambda ou outro ALB).

```hcl
resource "aws_lb" "app" {
  name               = "${var.project}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnet_ids
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.app.arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener_rule" "admin" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin.arn
  }

  condition {
    path_pattern { values = ["/admin/*"] }
  }
}
```

### Network Load Balancer (NLB) — Camada 4

O NLB lida com TCP/UDP/TLS com latência ultrabaixa. Use-o quando precisar de: **IPs estáticos** (um por AZ), exposição via **PrivateLink**, passagem TLS para os backends, ou requisitos de latência abaixo de milissegundo.

| | ALB | NLB |
|--|-----|-----|
| Camada | 7 (HTTP/HTTPS/gRPC) | 4 (TCP/UDP/TLS) |
| Roteamento | Regras baseadas em conteúdo | Somente IP/porta |
| IPs estáticos | Não (DNS dinâmico) | Sim (um por AZ) |
| Preserva IP do cliente | Header X-Forwarded-For | Nativo (proxy protocol) |
| PrivateLink | Não | Sim |

---

## Transit Gateway

O Transit Gateway é um roteador hub regional que conecta VPCs, conexões VPN e Direct Connect Gateways por meio de um modelo de anexo único — substituindo malhas complexas de VPC peering.

```
VPC A ─┐
VPC B ─┼─→ Transit Gateway ←── Direct Connect Gateway ←── On-prem
VPC C ─┘         │
                  └─→ VPN Connection ←── Filial
```

Conceitos principais:
- **Attachments** — VPC, VPN, Direct Connect GW, TGW Peering (entre regiões), Connect (SD-WAN)
- **Tabelas de rotas** — múltiplas tabelas permitem segmentação de tráfego (ex.: VPCs dev não alcançam VPCs prod)
- **Multicast** — opcional; para migração de multicast legado on-prem

!!! note "TGW vs VPC Peering"
    O VPC Peering não é transitivo e requer conexões O(n²) para uma malha completa. Use TGW quando tiver mais de 3–4 VPCs, precisar de conectividade on-prem ou requerer roteamento centralizado de egresso/inspeção.

---

## PrivateLink

O PrivateLink expõe um serviço (atrás de um NLB) como endpoint privado na VPC do consumidor — sem peering, alterações na tabela de rotas ou exposição à internet. Utilizado para:

- **AWS Interface Endpoints** — acesso privado a mais de 100 serviços AWS (ECR, Secrets Manager, SSM, etc.)
- **Serviços de parceiros** — provedores SaaS expõem endpoints na sua VPC
- **Compartilhamento de serviços internos** — exponha serviços de plataforma (ex.: serviço centralizado de autenticação) entre contas sem VPC peering

```hcl
# Expor um serviço interno via PrivateLink
resource "aws_vpc_endpoint_service" "platform" {
  acceptance_required        = false
  network_load_balancer_arns = [aws_lb.platform_nlb.arn]
  allowed_principals         = ["arn:aws:iam::${var.consumer_account_id}:root"]
}
```

---

[← Visão Geral AWS](index.md){ .md-button }
[Segurança & IAM →](security.md){ .md-button .md-button--primary }
