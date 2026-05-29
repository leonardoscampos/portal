---
hide:
  - toc
  - navigation
---

<div class="portal-intro">
  <div class="portal-intro-text">
    <span class="portal-eyebrow">// devops.engineering.portal</span>
    <h1 class="portal-title">Construir · Automatizar · Escalar</h1>
    <p class="portal-tagline" id="hero-tagline"></p>
    <div class="portal-cta">
      <a href="guides/intro/" class="md-button md-button--primary">Ver Guias</a>
      <a href="about-me/" class="md-button">Sobre Mim</a>
    </div>
  </div>
  <div class="terminal-mini">
    <div class="terminal-mini-header">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
      <span class="terminal-title">bash — leonardo@devops:~</span>
    </div>
    <div class="terminal-mini-body">
      <div class="terminal-line">
        <span class="terminal-prompt">$</span>
        <span class="cmd">ls -1 ~/dominios/</span>
      </div>
      <div class="tm-out">infraestrutura-cloud/</div>
      <div class="tm-out">infraestrutura-como-codigo/</div>
      <div class="tm-out">pipelines-cicd/</div>
      <div class="tm-out">containers-orquestracao/</div>
      <div class="tm-out">monitoramento-observabilidade/</div>
      <div class="tm-out">seguranca-devsecops/</div>
      <div class="terminal-line">
        <span class="terminal-prompt">$</span>
        <span class="typing-cursor">_</span>
      </div>
    </div>
  </div>
</div>

---

## Domínios

<div class="domain-grid">

  <a href="domains/cloud/" class="domain-card" data-domain="cloud">
    <div class="domain-card-top">
      <span class="domain-icon">&#9729;&#65039;</span>
      <div class="domain-meta">
        <span class="domain-name">Infraestrutura Cloud</span>
        <span class="domain-platform">AWS &middot; GCP &middot; Azure</span>
      </div>
    </div>
    <p class="domain-desc">Arquiteturas multi-cloud, VPCs, IAM, auto-scaling e governança de custos para workloads de produção.</p>
    <div class="domain-tools">
      <span class="tech-badge">AWS</span>
      <span class="tech-badge">GCP</span>
      <span class="tech-badge">Azure</span>
      <span class="tech-badge">OCI</span>
    </div>
  </a>

  <a href="domains/iac/" class="domain-card" data-domain="iac">
    <div class="domain-card-top">
      <span class="domain-icon">&#129521;</span>
      <div class="domain-meta">
        <span class="domain-name">Infraestrutura como Código</span>
        <span class="domain-platform">Terraform &middot; Ansible &middot; Helm &middot; Packer</span>
      </div>
    </div>
    <p class="domain-desc">Ciclos de vida de infraestrutura versionados e repetíveis. Declarativo em tudo, agnóstico de ambiente — sempre.</p>
    <div class="domain-tools">
      <span class="tech-badge">Terraform</span>
      <span class="tech-badge">Ansible</span>
      <span class="tech-badge">CloudFormation</span>
      <span class="tech-badge">Pulumi</span>
      <span class="tech-badge">Helm</span>
      <span class="tech-badge">GitOps</span>
      <span class="tech-badge">Packer</span>
    </div>
  </a>

  <a href="domains/cicd/" class="domain-card" data-domain="cicd">
    <div class="domain-card-top">
      <span class="domain-icon">&#128260;</span>
      <div class="domain-meta">
        <span class="domain-name">Pipelines CI/CD</span>
        <span class="domain-platform">GitHub Actions &middot; GitLab CI &middot; Tekton &middot; CircleCI</span>
      </div>
    </div>
    <p class="domain-desc">Entrega de ponta a ponta do commit à produção. Fluxos de release rápidos, auditáveis e totalmente automatizados.</p>
    <div class="domain-tools">
      <span class="tech-badge">GitHub Actions</span>
      <span class="tech-badge">GitLab CI</span>
      <span class="tech-badge">Jenkins</span>
      <span class="tech-badge">Tekton</span>
      <span class="tech-badge">Azure DevOps</span>
      <span class="tech-badge">CircleCI</span>
    </div>
  </a>

  <a href="domains/containers/" class="domain-card" data-domain="containers">
    <div class="domain-card-top">
      <span class="domain-icon">&#128230;</span>
      <div class="domain-meta">
        <span class="domain-name">Containers &amp; Orquestração</span>
        <span class="domain-platform">Docker &middot; Kubernetes &middot; Service Mesh &middot; Operators</span>
      </div>
    </div>
    <p class="domain-desc">Workloads em containers em escala. Deployments orientados a GitOps com rastreabilidade completa do ciclo de vida.</p>
    <div class="domain-tools">
      <span class="tech-badge">Docker</span>
      <span class="tech-badge">Kubernetes</span>
      <span class="tech-badge">Service Mesh</span>
      <span class="tech-badge">Operators</span>
      <span class="tech-badge">Container Security</span>
      <span class="tech-badge">Managed Kubernetes</span>
    </div>
  </a>

  <a href="domains/monitoring/" class="domain-card" data-domain="monitoring">
    <div class="domain-card-top">
      <span class="domain-icon">&#128202;</span>
      <div class="domain-meta">
        <span class="domain-name">Monitoramento &amp; Observabilidade</span>
        <span class="domain-platform">Prometheus &middot; Grafana &middot; Datadog &middot; Dynatrace</span>
      </div>
    </div>
    <p class="domain-desc">Observabilidade full-stack. Métricas, logs, traces e alertas proativos com acompanhamento de SLO/SLA.</p>
    <div class="domain-tools">
      <span class="tech-badge">Prometheus</span>
      <span class="tech-badge">Grafana</span>
      <span class="tech-badge">Loki</span>
      <span class="tech-badge">OpenTelemetry</span>
      <span class="tech-badge">Alerting</span>
      <span class="tech-badge">APM</span>
      <span class="tech-badge">Datadog</span>
      <span class="tech-badge">Dynatrace</span>
      <span class="tech-badge">ELK Stack</span>
    </div>
  </a>

  <a href="domains/security/" class="domain-card" data-domain="security">
    <div class="domain-card-top">
      <span class="domain-icon">&#128272;</span>
      <div class="domain-meta">
        <span class="domain-name">Segurança &amp; DevSecOps</span>
        <span class="domain-platform">Gestão de Segredos &middot; Política como Código &middot; Supply Chain</span>
      </div>
    </div>
    <p class="domain-desc">Segurança integrada em cada etapa do pipeline. Varredura shift-left, política como código e gestão de segredos.</p>
    <div class="domain-tools">
      <span class="tech-badge">Pipelines DevSecOps</span>
      <span class="tech-badge">Gestão de Segredos</span>
      <span class="tech-badge">Política como Código</span>
      <span class="tech-badge">Varredura de Vulnerabilidades</span>
      <span class="tech-badge">Identidade &amp; Acesso</span>
      <span class="tech-badge">Segurança da Supply Chain</span>
    </div>
  </a>

</div>

---

## Explorar

<div class="section-nav-grid">
  <a href="guides/" class="section-nav-card">
    <div class="snc-icon">&#128216;</div>
    <div class="snc-body">
      <span class="snc-label">Guias</span>
      <span class="snc-desc">Guias técnicos aprofundados sobre padrões de arquitetura, ferramentas e boas práticas de DevOps.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="tutorials/" class="section-nav-card">
    <div class="snc-icon">&#9881;&#65039;</div>
    <div class="snc-body">
      <span class="snc-label">Tutoriais</span>
      <span class="snc-desc">Walkthroughs passo a passo desde a configuração local até deployments em produção.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="blog/" class="section-nav-card">
    <div class="snc-icon">&#9997;&#65039;</div>
    <div class="snc-body">
      <span class="snc-label">Blog</span>
      <span class="snc-desc">Reflexões, histórias da trincheira e lições aprendidas na engenharia DevOps do mundo real.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
</div>

---

## Últimas Publicações

<div class="latest-grid">

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-iac">Infraestrutura</span>
      <span class="latest-date">Em breve</span>
    </div>
    <h3 class="latest-title">Terraform em Escala: Padrões de Design de Módulos</h3>
    <p class="latest-excerpt">Como projetar módulos Terraform reutilizáveis e versionados que funcionam em múltiplos ambientes e equipes sem drift.</p>
    <a class="latest-link" href="blog/">Ler mais &#8594;</a>
  </div>

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-containers">Kubernetes</span>
      <span class="latest-date">Em breve</span>
    </div>
    <h3 class="latest-title">Fluxos GitOps com ArgoCD e Helm</h3>
    <p class="latest-excerpt">Construindo um pipeline GitOps pronto para produção que mantém o estado do cluster sempre sincronizado com seu repositório Git.</p>
    <a class="latest-link" href="blog/">Ler mais &#8594;</a>
  </div>

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-monitoring">Observabilidade</span>
      <span class="latest-date">Em breve</span>
    </div>
    <h3 class="latest-title">SLOs, Error Budgets e Dashboards Grafana</h3>
    <p class="latest-excerpt">Implementando objetivos de nível de serviço do zero com recording rules do Prometheus e fluxos de alertas no Grafana.</p>
    <a class="latest-link" href="blog/">Ler mais &#8594;</a>
  </div>

</div>
