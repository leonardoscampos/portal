---
hide:
  - toc
title: Infraestrutura Cloud
description: Padrões de arquitetura multi-cloud, serviços principais e cadeias DevOps no AWS, Azure, GCP e OCI.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// infraestrutura-cloud</span>
    <h1 class="dph-title">Infraestrutura Cloud</h1>
    <p class="dph-desc">Arquiteturas multi-cloud, VPCs, IAM, auto-scaling e governança de custos para workloads de produção. Expertise profunda nos quatro principais provedores, com foco em automação, segurança e confiabilidade.</p>
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
      <p class="cph-desc">A plataforma de nuvem mais madura. Padrão de facto para workloads de produção em larga escala, com o catálogo de serviços mais completo, presença global e o ecossistema de IaC mais robusto.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../aws/compute/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127968; Computação</div>
        <div class="sg-items">
          <span class="tech-badge">EC2</span>
          <span class="tech-badge">ECS</span>
          <span class="tech-badge">EKS</span>
          <span class="tech-badge">Lambda</span>
          <span class="tech-badge">Fargate</span>
          <span class="tech-badge">Lightsail</span>
        </div>
        <p class="sg-note">EKS + Fargate para workloads em containers; EC2 Auto Scaling Groups para serviços com estado; Lambda para processamento orientado a eventos.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/storage/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128230; Armazenamento</div>
        <div class="sg-items">
          <span class="tech-badge">S3</span>
          <span class="tech-badge">EBS</span>
          <span class="tech-badge">EFS</span>
          <span class="tech-badge">FSx</span>
          <span class="tech-badge">Glacier</span>
        </div>
        <p class="sg-note">S3 como backbone para artefatos, backups e assets estáticos. EBS gp3 para PVs do Kubernetes, EFS para workloads compartilhados.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/networking/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127760; Redes</div>
        <div class="sg-items">
          <span class="tech-badge">VPC</span>
          <span class="tech-badge">Route 53</span>
          <span class="tech-badge">CloudFront</span>
          <span class="tech-badge">ALB / NLB</span>
          <span class="tech-badge">Transit GW</span>
          <span class="tech-badge">PrivateLink</span>
        </div>
        <p class="sg-note">Topologia hub-and-spoke com Transit Gateway. Sub-redes privadas com NAT Gateways; PrivateLink para exposição de serviços sem IPs públicos.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/security/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128274; Segurança &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">IAM</span>
          <span class="tech-badge">SCPs</span>
          <span class="tech-badge">Organizations</span>
          <span class="tech-badge">KMS</span>
          <span class="tech-badge">Secrets Manager</span>
          <span class="tech-badge">GuardDuty</span>
        </div>
        <p class="sg-note">Roles IAM com menor privilégio, SCPs no nível da OU, criptografia em envelope via KMS, detecção de ameaças em runtime com GuardDuty.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/observability/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128202; Observabilidade</div>
        <div class="sg-items">
          <span class="tech-badge">CloudWatch</span>
          <span class="tech-badge">X-Ray</span>
          <span class="tech-badge">CloudTrail</span>
          <span class="tech-badge">AWS Config</span>
          <span class="tech-badge">Cost Explorer</span>
        </div>
        <p class="sg-note">CloudWatch Metrics + Container Insights para EKS. X-Ray para rastreamento distribuído. AWS Config para detecção de drift de conformidade.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../aws/iac/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">CDK</span>
          <span class="tech-badge">CloudFormation</span>
          <span class="tech-badge">CodePipeline</span>
          <span class="tech-badge">CodeBuild</span>
          <span class="tech-badge">ECR</span>
        </div>
        <p class="sg-note">Terraform (provider AWS) preferido para portabilidade multi-cloud. CDK para autoria de stacks orientada ao desenvolvedor. ECR como registro privado de containers.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

    </div>

=== "Azure"

    <div class="cloud-provider-header" data-provider="azure">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#0078d4"></span>
        <span class="cph-name">Microsoft Azure</span>
      </div>
      <p class="cph-desc">Nuvem corporativa com integração profunda ao Active Directory, conectividade híbrida via Azure Arc e um serviço gerenciado de Kubernetes (AKS) que se integra perfeitamente ao ecossistema Microsoft.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../azure/compute/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127968; Computação</div>
        <div class="sg-items">
          <span class="tech-badge">Azure VMs</span>
          <span class="tech-badge">AKS</span>
          <span class="tech-badge">App Service</span>
          <span class="tech-badge">Azure Functions</span>
          <span class="tech-badge">Container Apps</span>
          <span class="tech-badge">Azure Arc</span>
        </div>
        <p class="sg-note">AKS para orquestração de containers com Azure CNI e node pools gerenciados. Container Apps (KEDA) para containers serverless. Azure Arc para ambientes híbridos e edge.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/storage/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128230; Armazenamento</div>
        <div class="sg-items">
          <span class="tech-badge">Blob Storage</span>
          <span class="tech-badge">Azure Files</span>
          <span class="tech-badge">Managed Disks</span>
          <span class="tech-badge">Data Lake Gen2</span>
          <span class="tech-badge">Azure Backup</span>
        </div>
        <p class="sg-note">Blob Storage com políticas de ciclo de vida para arquivamento em camadas. Managed Disks (Premium SSD v2) para volumes persistentes do AKS. Data Lake Gen2 para pipelines analíticos.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/networking/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127760; Redes</div>
        <div class="sg-items">
          <span class="tech-badge">VNet</span>
          <span class="tech-badge">Azure DNS</span>
          <span class="tech-badge">Front Door</span>
          <span class="tech-badge">App Gateway</span>
          <span class="tech-badge">ExpressRoute</span>
          <span class="tech-badge">Private Endpoint</span>
        </div>
        <p class="sg-note">VNets hub-spoke interconectadas via Azure Virtual WAN. Private Endpoints para serviços PaaS. Front Door + WAF para balanceamento global com proteção DDoS.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/security/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128274; Segurança &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">Entra ID</span>
          <span class="tech-badge">RBAC</span>
          <span class="tech-badge">Key Vault</span>
          <span class="tech-badge">Defender for Cloud</span>
          <span class="tech-badge">Policy</span>
          <span class="tech-badge">PIM</span>
        </div>
        <p class="sg-note">Entra ID Workload Identity para autenticação no nível de pod no AKS. Azure Policy para guardrails no escopo do management group. Defender for Cloud para gestão de postura de segurança.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/observability/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128202; Observabilidade</div>
        <div class="sg-items">
          <span class="tech-badge">Azure Monitor</span>
          <span class="tech-badge">Log Analytics</span>
          <span class="tech-badge">App Insights</span>
          <span class="tech-badge">Container Insights</span>
          <span class="tech-badge">Cost Management</span>
        </div>
        <p class="sg-note">Workspace do Log Analytics centraliza todos os logs de plataforma e aplicação. Application Insights para APM. Container Insights para monitoramento do cluster AKS out-of-the-box.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../azure/iac/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Bicep</span>
          <span class="tech-badge">Azure DevOps</span>
          <span class="tech-badge">Pipelines</span>
          <span class="tech-badge">ACR</span>
          <span class="tech-badge">Flux v2</span>
        </div>
        <p class="sg-note">Provider AzureRM do Terraform com remote state no Azure Storage. Bicep para ARM nativo com sintaxe mais limpa. ACR como registro privado de containers; Flux v2 para GitOps.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

    </div>

=== "GCP"

    <div class="cloud-provider-header" data-provider="gcp">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#4285f4"></span>
        <span class="cph-name">Google Cloud Platform</span>
      </div>
      <p class="cph-desc">A nuvem nascida da infraestrutura interna do Google. Lar do Kubernetes (GKE é o padrão ouro), containers serverless (Cloud Run) e a plataforma mais avançada de dados/ML. Infraestrutura de rede superior com excelente custo-benefício.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../gcp/compute/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127968; Computação</div>
        <div class="sg-items">
          <span class="tech-badge">GKE</span>
          <span class="tech-badge">Compute Engine</span>
          <span class="tech-badge">Cloud Run</span>
          <span class="tech-badge">Cloud Functions</span>
          <span class="tech-badge">GKE Autopilot</span>
          <span class="tech-badge">Batch</span>
        </div>
        <p class="sg-note">GKE (Standard ou Autopilot) é o padrão ouro de Kubernetes gerenciado. Cloud Run para containers sem estado sem sobrecarga de cluster. Spot VMs para workloads batch com custo reduzido.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/storage/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128230; Armazenamento</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud Storage</span>
          <span class="tech-badge">Persistent Disk</span>
          <span class="tech-badge">Filestore</span>
          <span class="tech-badge">Cloud SQL</span>
          <span class="tech-badge">AlloyDB</span>
        </div>
        <p class="sg-note">Cloud Storage (GCS) para objetos e artefatos com consistência forte. Persistent Disk SSD para PVs do GKE. Filestore para workloads NFS compartilhados. AlloyDB para OLTP compatível com PostgreSQL.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/networking/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127760; Redes</div>
        <div class="sg-items">
          <span class="tech-badge">VPC</span>
          <span class="tech-badge">Cloud DNS</span>
          <span class="tech-badge">Cloud CDN</span>
          <span class="tech-badge">Cloud Load Balancing</span>
          <span class="tech-badge">Cloud NAT</span>
          <span class="tech-badge">Cloud Interconnect</span>
        </div>
        <p class="sg-note">VPC global (sem fronteiras regionais). Load Balancers externos/internos com Serverless NEGs. Cloud NAT para egress sem bastion hosts.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/security/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128274; Segurança &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud IAM</span>
          <span class="tech-badge">Workload Identity</span>
          <span class="tech-badge">Secret Manager</span>
          <span class="tech-badge">Cloud KMS</span>
          <span class="tech-badge">Security Command Center</span>
          <span class="tech-badge">VPC-SC</span>
        </div>
        <p class="sg-note">Workload Identity Federation elimina chaves de service account. VPC Service Controls para prevenção de exfiltração de dados. Security Command Center para postura de segurança e detecção de ameaças.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/observability/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128202; Observabilidade</div>
        <div class="sg-items">
          <span class="tech-badge">Cloud Monitoring</span>
          <span class="tech-badge">Cloud Logging</span>
          <span class="tech-badge">Cloud Trace</span>
          <span class="tech-badge">Cloud Profiler</span>
          <span class="tech-badge">Error Reporting</span>
        </div>
        <p class="sg-note">Managed Prometheus (GMP) integra nativamente com GKE. Cloud Logging exporta para BigQuery para retenção e análise de longo prazo. Monitoramento de SLO integrado ao Cloud Monitoring.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../gcp/iac/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Config Connector</span>
          <span class="tech-badge">Cloud Build</span>
          <span class="tech-badge">Artifact Registry</span>
          <span class="tech-badge">Cloud Deploy</span>
          <span class="tech-badge">Config Sync</span>
        </div>
        <p class="sg-note">Provider Google do Terraform com backend remoto no GCS. Cloud Build para CI; Cloud Deploy para entrega progressiva ao GKE. Config Sync (ACM) para GitOps em escala.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

    </div>

=== "OCI"

    <div class="cloud-provider-header" data-provider="oci">
      <div class="cph-brand">
        <span class="cph-dot" style="background:#f80000"></span>
        <span class="cph-name">Oracle Cloud Infrastructure</span>
      </div>
      <p class="cph-desc">Uma nuvem de segunda geração séria com preços previsíveis, performance bare-metal e forte integração com workloads Oracle. OKE (Container Engine for Kubernetes) é pronto para produção. O tier Always Free é o mais generoso do setor.</p>
    </div>

    <div class="services-grid">

      <div class="service-group service-group--link">
      <a href="../oci/compute/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127968; Computação</div>
        <div class="sg-items">
          <span class="tech-badge">Compute Instances</span>
          <span class="tech-badge">OKE</span>
          <span class="tech-badge">Container Instances</span>
          <span class="tech-badge">Oracle Functions</span>
          <span class="tech-badge">Ampere A1</span>
        </div>
        <p class="sg-note">OKE com control plane gerenciado e Virtual Nodes. Ampere A1 (ARM) oferece o melhor custo-benefício na OCI. Container Instances para containers serverless sem overhead do Kubernetes.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/storage/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128230; Armazenamento</div>
        <div class="sg-items">
          <span class="tech-badge">Object Storage</span>
          <span class="tech-badge">Block Volumes</span>
          <span class="tech-badge">File Storage</span>
          <span class="tech-badge">Archive Storage</span>
          <span class="tech-badge">Data Transfer</span>
        </div>
        <p class="sg-note">Object Storage com API compatível com S3 — configurações existentes de backend Terraform S3 funcionam com mínimas alterações. Block Volumes com IOPS ultra-alto para workloads de banco de dados.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/networking/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#127760; Redes</div>
        <div class="sg-items">
          <span class="tech-badge">VCN</span>
          <span class="tech-badge">Load Balancer</span>
          <span class="tech-badge">Network Firewall</span>
          <span class="tech-badge">FastConnect</span>
          <span class="tech-badge">DNS</span>
          <span class="tech-badge">Service Gateway</span>
        </div>
        <p class="sg-note">VCN com security lists e NSGs. Service Gateway para acesso privado a serviços OCI sem NAT. FastConnect para conectividade dedicada on-premises. Network Firewall (Palo Alto) na borda.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/security/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128274; Segurança &amp; IAM</div>
        <div class="sg-items">
          <span class="tech-badge">OCI IAM</span>
          <span class="tech-badge">Vault</span>
          <span class="tech-badge">Security Zones</span>
          <span class="tech-badge">Cloud Guard</span>
          <span class="tech-badge">Bastion</span>
          <span class="tech-badge">Certificates</span>
        </div>
        <p class="sg-note">Dynamic Groups + Instance Principals para identidade de workload — sem credenciais estáticas nos pods do OKE. Security Zones aplicam políticas no nível do compartimento. Cloud Guard para detecção contínua de ameaças.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/observability/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#128202; Observabilidade</div>
        <div class="sg-items">
          <span class="tech-badge">OCI Monitoring</span>
          <span class="tech-badge">Logging</span>
          <span class="tech-badge">Logging Analytics</span>
          <span class="tech-badge">APM</span>
          <span class="tech-badge">Ops Insights</span>
        </div>
        <p class="sg-note">OCI Monitoring integra com Prometheus via endpoint remote_write. Logging Analytics para investigações de logs baseadas em padrões. APM com suporte a OpenTelemetry para rastreamento distribuído.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

      <div class="service-group service-group--link">
      <a href="../oci/iac/" class="sg-card-link" aria-label="Saiba mais"></a>
        <div class="sg-label">&#9881;&#65039; IaC &amp; DevOps</div>
        <div class="sg-items">
          <span class="tech-badge">Terraform</span>
          <span class="tech-badge">Resource Manager</span>
          <span class="tech-badge">OCI DevOps</span>
          <span class="tech-badge">Container Registry</span>
          <span class="tech-badge">Artifact Registry</span>
        </div>
        <p class="sg-note">O provider OCI do Terraform é de primeira classe; Resource Manager é Terraform gerenciado pela OCI com estado armazenado na OCI. OCI DevOps oferece pipelines de build e deploy com estratégias nativas para OKE.</p>
        <span class="sg-more">Saiba mais &#8594;</span>
      </div>

    </div>
