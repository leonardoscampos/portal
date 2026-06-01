---
title: AWS Networking
description: VPC, Route 53, CloudFront, ALB/NLB, Transit Gateway — AWS networking fundamentals.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / networking</span>
    <h1 class="dph-title">AWS Networking</h1>
    <p class="dph-desc">Private networks, global DNS, edge delivery, load balancing and hybrid connectivity. AWS networking is the foundation every cloud workload is built on — getting the design right early saves significant refactoring later.</p>
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

A VPC is an isolated virtual network within a region. Every production workload starts here — get the CIDR design right before you create anything else.

### Subnet design

| Subnet type | Route table | Typical use |
|------------|------------|------------|
| **Public** | → Internet Gateway | Load balancers, NAT Gateways, bastion hosts |
| **Private** | → NAT Gateway | App servers, EKS nodes, ECS tasks, databases |
| **Isolated** | Local only | RDS, ElastiCache, internal services with no internet need |

!!! tip "CIDR planning"
    Use a `/16` per VPC (65,534 IPs) and allocate `/24` subnets per AZ per tier (gives 254 hosts each). Reserve the last `/24` block in each tier for future AZs. Avoid `10.0.0.0/8` if you plan to peer with on-prem networks that already use it — use `100.64.0.0/10` (IANA Shared Address Space) for VPC-internal traffic.

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
  single_nat_gateway     = false  # one NAT per AZ for HA
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Required tags for EKS
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }
}
```

### VPC Endpoints

VPC Endpoints allow private access to AWS services without traversing the internet or NAT Gateway, reducing egress cost and latency.

| Type | Examples | Cost |
|------|---------|------|
| **Gateway** | S3, DynamoDB | Free |
| **Interface** (PrivateLink) | ECR, Secrets Manager, SSM, KMS, CloudWatch | ~$0.01/hr/AZ |

```hcl
# Gateway endpoint for S3 (free — always create this)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
}
```

### VPC Flow Logs

Enable Flow Logs on every production VPC. Send to S3 for cost-effective long-term retention; query with Athena. Send to CloudWatch Logs for real-time alerting.

---

## Route 53

Route 53 is AWS's managed DNS and health checking service. It supports both **public hosted zones** (internet-resolvable) and **private hosted zones** (VPC-internal).

### Routing policies

| Policy | Use case |
|--------|---------|
| **Simple** | Single resource, no health check |
| **Weighted** | A/B deployments, traffic shifting between origins |
| **Latency** | Route to the lowest-latency region |
| **Failover** | Active/passive DR — primary + secondary with health check |
| **Geolocation** | Compliance, content localisation |
| **Geoproximity** | Traffic engineering with bias adjustment |
| **Multivalue** | Up to 8 healthy records returned (not a load balancer replacement) |

```hcl
# Private hosted zone for service-to-service DNS
resource "aws_route53_zone" "internal" {
  name = "${var.env}.internal.example.com"

  vpc {
    vpc_id = module.vpc.vpc_id
  }
}

# Weighted routing for canary deployment
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

CloudFront is AWS's global CDN with 600+ edge locations. It caches content close to users and integrates with WAF, ACM (free TLS), Lambda@Edge and CloudFront Functions.

### Distribution anatomy

```
Browser → CloudFront Edge
           ├── Cache hit → serve immediately
           └── Cache miss → forward to Origin
                             ├── S3 (static assets, SPA)
                             ├── ALB (dynamic API)
                             └── Custom HTTP origin
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
    **CloudFront Functions** run at the edge (sub-ms, 1/6 the cost) for simple URL rewrites, header manipulation and auth token validation. **Lambda@Edge** runs at Regional Edge Caches with full Node.js/Python and up to 30-second timeout — use for OAuth flows, A/B testing, dynamic personalisation.

---

## ALB & NLB

### Application Load Balancer (ALB) — Layer 7

ALB routes HTTP/HTTPS traffic based on **rules**: host header, path, query string, HTTP method, source IP, or HTTP headers. Each rule targets a **Target Group** (EC2 instances, ECS tasks by IP, Lambda, or another ALB).

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

### Network Load Balancer (NLB) — Layer 4

NLB handles TCP/UDP/TLS at ultra-low latency. Use it when you need: **static IPs** (one per AZ), **PrivateLink** exposure, TLS passthrough to backends, or sub-millisecond latency requirements.

| | ALB | NLB |
|--|-----|-----|
| Layer | 7 (HTTP/HTTPS/gRPC) | 4 (TCP/UDP/TLS) |
| Routing | Content-based rules | IP/port only |
| Static IPs | No (dynamic DNS) | Yes (one per AZ) |
| Preserve client IP | X-Forwarded-For header | Native (proxy protocol) |
| PrivateLink | No | Yes |

---

## Transit Gateway

Transit Gateway is a regional hub router that connects VPCs, VPN connections and Direct Connect Gateways through a single attachment model — replacing complex VPC peering meshes.

```
VPC A ─┐
VPC B ─┼─→ Transit Gateway ←── Direct Connect Gateway ←── On-prem
VPC C ─┘         │
                  └─→ VPN Connection ←── Branch office
```

Key concepts:
- **Attachments** — VPC, VPN, Direct Connect GW, TGW Peering (cross-region), Connect (SD-WAN)
- **Route tables** — multiple route tables enable traffic segmentation (e.g. dev VPCs can't reach prod VPCs)
- **Multicast** — optional; for legacy on-prem multicast migration

!!! note "TGW vs VPC Peering"
    VPC Peering is non-transitive and requires O(n²) connections for a full mesh. Use TGW when you have more than 3–4 VPCs, need on-prem connectivity, or require centralised egress/inspection routing.

---

## PrivateLink

PrivateLink exposes a service (behind an NLB) as a private endpoint in a consumer's VPC — without peering, routing table changes or internet exposure. Used for:

- **AWS Interface Endpoints** — private access to 100+ AWS services (ECR, Secrets Manager, SSM, etc.)
- **Partner services** — SaaS providers expose endpoints in your VPC
- **Internal service sharing** — expose platform services (e.g. a centralised auth service) across accounts without VPC peering

```hcl
# Expose an internal service via PrivateLink
resource "aws_vpc_endpoint_service" "platform" {
  acceptance_required        = false
  network_load_balancer_arns = [aws_lb.platform_nlb.arn]
  allowed_principals         = ["arn:aws:iam::${var.consumer_account_id}:root"]
}
```

---

[← AWS Overview](index.md){ .md-button }
[Security & IAM →](security.md){ .md-button .md-button--primary }
