---
hide:
  - toc
title: Cloud Infrastructure
description: Multi-cloud architecture patterns, key services and DevOps toolchains across AWS, Azure, GCP and OCI.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// cloud-infrastructure</span>
    <h1 class="dph-title">Cloud Infrastructure</h1>
    <p class="dph-desc">Multi-cloud architectures, VPCs, IAM, auto-scaling and cost governance for production workloads. Deep expertise across the four major providers, with a focus on automation, security and reliability.</p>
    <div class="dph-badges">
      <a href="aws/overview/" class="tech-badge">AWS</a>
      <a href="azure/overview/" class="tech-badge">Azure</a>
      <a href="gcp/overview/" class="tech-badge">GCP</a>
      <a href="oci/overview/" class="tech-badge">OCI</a>
      <a href="iac/terraform/" class="tech-badge">Terraform</a>
      <a href="containers/kubernetes/" class="tech-badge">Kubernetes</a>
    </div>
  </div>
  <div class="dph-right">
    <div class="provider-strip">
      <div class="provider-chip" data-provider="aws">
        <span class="provider-chip-dot" style="background:#ff9900"></span>
        <span class="provider-chip-name">Amazon Web Services</span>
      </div>
      <div class="provider-chip" data-provider="azure">
        <span class="provider-chip-dot" style="background:#0078d4"></span>
        <span class="provider-chip-name">Microsoft Azure</span>
      </div>
      <div class="provider-chip" data-provider="gcp">
        <span class="provider-chip-dot" style="background:#4285f4"></span>
        <span class="provider-chip-name">Google Cloud</span>
      </div>
      <div class="provider-chip" data-provider="oci">
        <span class="provider-chip-dot" style="background:#f80000"></span>
        <span class="provider-chip-name">Oracle Cloud</span>
      </div>
    </div>
  </div>
</div>

---

=== "AWS"

    <div class="cloud-provider-header" data-provider="aws">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#ff9900"></span>
        <span class="cph-name">Amazon Web Services</span>
      </div>
      <p class="cph-desc">The most mature cloud platform. De facto standard for large-scale production workloads, with the deepest service catalog, global footprint and strongest IaC ecosystem.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../aws/compute/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127968; Compute</div>
        <div class="sg-items">
          <span class="tech-badge">EC2</span>
          <span class="tech-badge">ECS</span>
          <span class="tech-badge">EKS</span>
          <span class="tech-badge">Lambda</span>
          <span class="tech-badge">Fargate</span>
          <span class="tech-badge">Lightsail</span>
        </div>
        <p class="sg-note">EKS + Fargate for container workloads; EC2 Auto Scaling Groups for stateful services; Lambda for event-driven processing.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/storage/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128230; Storage</div>
        <div class="sg-items">
          <span class="tech-badge">S3</span>
          <span class="tech-badge">EBS</span>
          <span class="tech-badge">EFS</span>
          <span class="tech-badge">FSx</span>
          <span class="tech-badge">Glacier</span>
        </div>
        <p class="sg-note">S3 as the backbone for artefact storage, backups and static assets. EBS gp3 for Kubernetes PVs, EFS for shared workloads.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/networking/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127760; Networking</div>
        <div class="sg-items">
          <span class="tech-badge">VPC</span>
          <span class="tech-badge">Route 53</span>
          <span class="tech-badge">CloudFront</span>
          <span class="tech-badge">ALB / NLB</span>
          <span class="tech-badge">Transit GW</span>
          <span class="tech-badge">PrivateLink</span>
        </div>
        <p class="sg-note">Hub-and-spoke topology with Transit Gateway. Private subnets with NAT Gateways; PrivateLink for service exposure without public IPs.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/security/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128274; Security &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">IAM</span>
          <span class="tech-badge">SCPs</span>
          <span class="tech-badge">Organizations</span>
          <span class="tech-badge">KMS</span>
          <span class="tech-badge">Secrets Manager</span>
          <span class="tech-badge">GuardDuty</span>
        </div>
        <p class="sg-note">Least-privilege IAM roles, SCPs at the OU level, envelope encryption via KMS, runtime threat detection with GuardDuty.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/observability/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128202; Observability</div>
        <div class="sg-items">
          <span class="tech-badge">CloudWatch</span>
          <span class="tech-badge">X-Ray</span>
          <span class="tech-badge">CloudTrail</span>
          <span class="tech-badge">AWS Config</span>
          <span class="tech-badge">Cost Explorer</span>
        </div>
        <p class="sg-note">CloudWatch Metrics + Container Insights for EKS. X-Ray for distributed tracing. AWS Config for compliance drift detection.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/iac/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">CDK</span>
          <span class="tech-badge">CloudFormation</span>
          <span class="tech-badge">CodePipeline</span>
          <span class="tech-badge">CodeBuild</span>
          <span class="tech-badge">ECR</span>
        </div>
        <p class="sg-note">Terraform (AWS provider) preferred for multi-cloud portability. CDK for developer-centric stack authoring. ECR as the private container registry.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

    </div>

=== "Azure"

    <div class="cloud-provider-header" data-provider="azure">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#0078d4"></span>
        <span class="cph-name">Microsoft Azure</span>
      </div>
      <p class="cph-desc">Enterprise-grade cloud with deep Active Directory integration, hybrid connectivity via Azure Arc and a first-class Kubernetes managed service (AKS) that integrates seamlessly with the Microsoft toolchain.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../azure/compute/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127968; Compute</div>
        <div class="sg-items">
          <span class="tech-badge">Azure VMs</span>
          <span class="tech-badge">AKS</span>
          <span class="tech-badge">App Service</span>
          <span class="tech-badge">Azure Functions</span>
          <span class="tech-badge">Container Apps</span>
          <span class="tech-badge">Azure Arc</span>
        </div>
        <p class="sg-note">AKS for container orchestration with Azure CNI and managed node pools. Container Apps (KEDA-powered) for serverless containers. Azure Arc for hybrid/edge.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/storage/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128230; Storage</div>
        <div class="sg-items">
          <span class="tech-badge">Blob Storage</span>
          <span class="tech-badge">Azure Files</span>
          <span class="tech-badge">Managed Disks</span>
          <span class="tech-badge">Data Lake Gen2</span>
          <span class="tech-badge">Azure Backup</span>
        </div>
        <p class="sg-note">Blob Storage with lifecycle policies for tiered archiving. Managed Disks (Premium SSD v2) for AKS persistent volumes. Data Lake Gen2 for analytics pipelines.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/networking/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127760; Networking</div>
        <div class="sg-items">
          <span class="tech-badge">VNet</span>
          <span class="tech-badge">Azure DNS</span>
          <span class="tech-badge">Front Door</span>
          <span class="tech-badge">App Gateway</span>
          <span class="tech-badge">ExpressRoute</span>
          <span class="tech-badge">Private Endpoint</span>
        </div>
        <p class="sg-note">Hub-spoke VNets peered through Azure Virtual WAN. Private Endpoints for PaaS services. Front Door + WAF for global load balancing with DDoS protection.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/security/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128274; Security &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">Entra ID</span>
          <span class="tech-badge">RBAC</span>
          <span class="tech-badge">Key Vault</span>
          <span class="tech-badge">Defender for Cloud</span>
          <span class="tech-badge">Policy</span>
          <span class="tech-badge">PIM</span>
        </div>
        <p class="sg-note">Entra ID Workload Identity for pod-level auth in AKS. Azure Policy for guardrails at management group scope. Defender for Cloud for posture management.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/observability/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128202; Observability</div>
        <div class="sg-items">
          <span class="tech-badge">Azure Monitor</span>
          <span class="tech-badge">Log Analytics</span>
          <span class="tech-badge">App Insights</span>
          <span class="tech-badge">Container Insights</span>
          <span class="tech-badge">Cost Management</span>
        </div>
        <p class="sg-note">Log Analytics workspace centralises all platform and app logs. Application Insights for APM. Container Insights for AKS cluster monitoring out of the box.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/iac/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Bicep</span>
          <span class="tech-badge">Azure DevOps</span>
          <span class="tech-badge">Pipelines</span>
          <span class="tech-badge">ACR</span>
          <span class="tech-badge">Flux v2</span>
        </div>
        <p class="sg-note">Terraform AzureRM provider with remote state in Azure Storage. Bicep for native ARM with cleaner syntax. ACR as the private container registry; Flux v2 for GitOps.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

    </div>

=== "GCP"

    <div class="cloud-provider-header" data-provider="gcp">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#4285f4"></span>
        <span class="cph-name">Google Cloud Platform</span>
      </div>
      <p class="cph-desc">The cloud born from Google's internal infrastructure. Home of Kubernetes (GKE is the gold standard), serverless containers (Cloud Run), and the most advanced data/ML platform. Strong network infrastructure and excellent cost-per-performance.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../gcp/compute/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127968; Compute</div>
        <div class="sg-items">
          <span class="tech-badge">GKE</span>
          <span class="tech-badge">Compute Engine</span>
          <span class="tech-badge">Cloud Run</span>
          <span class="tech-badge">Cloud Functions</span>
          <span class="tech-badge">GKE Autopilot</span>
          <span class="tech-badge">Batch</span>
        </div>
        <p class="sg-note">GKE (Standard or Autopilot) is the managed Kubernetes gold standard. Cloud Run for stateless containers without cluster overhead. Spot VMs for cost-efficient batch workloads.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/storage/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128230; Storage</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud Storage</span>
          <span class="tech-badge">Persistent Disk</span>
          <span class="tech-badge">Filestore</span>
          <span class="tech-badge">Cloud SQL</span>
          <span class="tech-badge">AlloyDB</span>
        </div>
        <p class="sg-note">Cloud Storage (GCS) for object/artefact storage with strong consistency. Persistent Disk SSD for GKE PVs. Filestore for shared NFS workloads. AlloyDB for PostgreSQL-compatible OLTP.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/networking/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127760; Networking</div>
        <div class="sg-items">
          <span class="tech-badge">VPC</span>
          <span class="tech-badge">Cloud DNS</span>
          <span class="tech-badge">Cloud CDN</span>
          <span class="tech-badge">Cloud Load Balancing</span>
          <span class="tech-badge">Cloud NAT</span>
          <span class="tech-badge">Cloud Interconnect</span>
        </div>
        <p class="sg-note">Global VPC (no regional boundaries). External/Internal Application Load Balancers backed by Serverless NEGs. Cloud NAT for egress without bastion hosts.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/security/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128274; Security &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud IAM</span>
          <span class="tech-badge">Workload Identity</span>
          <span class="tech-badge">Secret Manager</span>
          <span class="tech-badge">Cloud KMS</span>
          <span class="tech-badge">Security Command Center</span>
          <span class="tech-badge">VPC-SC</span>
        </div>
        <p class="sg-note">Workload Identity Federation eliminates service account key files. VPC Service Controls for data exfiltration prevention. Security Command Center for posture and threat detection.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/observability/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128202; Observability</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud Monitoring</span>
          <span class="tech-badge">Cloud Logging</span>
          <span class="tech-badge">Cloud Trace</span>
          <span class="tech-badge">Cloud Profiler</span>
          <span class="tech-badge">Error Reporting</span>
        </div>
        <p class="sg-note">Managed Prometheus (GMP) integrates natively with GKE. Cloud Logging exports to BigQuery for long-term retention and analytics. SLO monitoring built into Cloud Monitoring.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/iac/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Config Connector</span>
          <span class="tech-badge">Cloud Build</span>
          <span class="tech-badge">Artifact Registry</span>
          <span class="tech-badge">Cloud Deploy</span>
          <span class="tech-badge">Config Sync</span>
        </div>
        <p class="sg-note">Terraform Google provider with GCS remote backend. Cloud Build for CI; Cloud Deploy for progressive delivery to GKE. Config Sync (ACM) for GitOps at scale.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

    </div>

=== "OCI"

    <div class="cloud-provider-header" data-provider="oci">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#f80000"></span>
        <span class="cph-name">Oracle Cloud Infrastructure</span>
      </div>
      <p class="cph-desc">A serious second-generation cloud with predictable pricing, bare-metal performance and strong Oracle workload integration. OKE (Container Engine for Kubernetes) is production-ready. The Always Free tier is the most generous in the industry.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../oci/compute/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127968; Compute</div>
        <div class="sg-items">
          <span class="tech-badge">Compute Instances</span>
          <span class="tech-badge">OKE</span>
          <span class="tech-badge">Container Instances</span>
          <span class="tech-badge">Oracle Functions</span>
          <span class="tech-badge">Ampere A1</span>
        </div>
        <p class="sg-note">OKE with managed control plane and Virtual Nodes. Ampere A1 (ARM) offers the best price/performance on OCI. Container Instances for serverless containers without Kubernetes overhead.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/storage/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128230; Storage</div>
        <div class="sg-items">
          <span class="tech-badge">Object Storage</span>
          <span class="tech-badge">Block Volumes</span>
          <span class="tech-badge">File Storage</span>
          <span class="tech-badge">Archive Storage</span>
          <span class="tech-badge">Data Transfer</span>
        </div>
        <p class="sg-note">Object Storage with S3-compatible API — existing Terraform S3 backend configs work with minimal changes. Block Volumes with ultra-high IOPS for DB workloads. File Storage (NFS v3/v4.1) for shared mounts.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/networking/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#127760; Networking</div>
        <div class="sg-items">
          <span class="tech-badge">VCN</span>
          <span class="tech-badge">Load Balancer</span>
          <span class="tech-badge">Network Firewall</span>
          <span class="tech-badge">FastConnect</span>
          <span class="tech-badge">DNS</span>
          <span class="tech-badge">Service Gateway</span>
        </div>
        <p class="sg-note">VCN with security lists and NSGs. Service Gateway for private access to OCI services without NAT. FastConnect for dedicated on-prem connectivity. Network Firewall (Palo Alto-powered) at the edge.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/security/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128274; Security &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">OCI IAM</span>
          <span class="tech-badge">Vault</span>
          <span class="tech-badge">Security Zones</span>
          <span class="tech-badge">Cloud Guard</span>
          <span class="tech-badge">Bastion</span>
          <span class="tech-badge">Certificates</span>
        </div>
        <p class="sg-note">Dynamic Groups + Instance Principals for workload identity — no static credentials in OKE pods. Security Zones enforce policy at the compartment level. Cloud Guard for continuous threat detection.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/observability/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#128202; Observability</div>
        <div class="sg-items">
          <span class="tech-badge">OCI Monitoring</span>
          <span class="tech-badge">Logging</span>
          <span class="tech-badge">Logging Analytics</span>
          <span class="tech-badge">APM</span>
          <span class="tech-badge">Ops Insights</span>
        </div>
        <p class="sg-note">OCI Monitoring integrates with Prometheus via the remote_write endpoint. Logging Analytics for pattern-based log investigations. APM with OpenTelemetry support for distributed tracing.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/iac/" class="sg-card-link" aria-label="Learn more"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Resource Manager</span>
          <span class="tech-badge">OCI DevOps</span>
          <span class="tech-badge">Container Registry</span>
          <span class="tech-badge">Artifact Registry</span>
        </div>
        <p class="sg-note">Terraform OCI provider is first-class; Resource Manager is OCI-managed Terraform with state stored in OCI. OCI DevOps provides build + deploy pipelines with OKE-native deployment strategies.</p>
        <span class="sg-more">Learn more &#8594;</span>
      </div>

    </div>

