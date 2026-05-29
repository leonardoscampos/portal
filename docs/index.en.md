---
hide:
  - toc
  - navigation
---

<div class="portal-intro">
  <div class="portal-intro-text">
    <span class="portal-eyebrow">// devops.engineering.portal</span>
    <h1 class="portal-title">Build · Automate · Scale</h1>
    <p class="portal-tagline" id="hero-tagline"></p>
    <div class="portal-cta">
      <a href="guides/intro/" class="md-button md-button--primary">Browse Guides</a>
      <a href="about-me/" class="md-button">About Me</a>
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
        <span class="cmd">ls -1 ~/domains/</span>
      </div>
      <div class="tm-out">cloud-infrastructure/</div>
      <div class="tm-out">infrastructure-as-code/</div>
      <div class="tm-out">cicd-pipelines/</div>
      <div class="tm-out">containers-orchestration/</div>
      <div class="tm-out">monitoring-observability/</div>
      <div class="tm-out">security-devsecops/</div>
      <div class="terminal-line">
        <span class="terminal-prompt">$</span>
        <span class="typing-cursor">_</span>
      </div>
    </div>
  </div>
</div>

---

## Domains

<div class="domain-grid">

  <a href="domains/cloud/" class="domain-card" data-domain="cloud">
    <div class="domain-card-top">
      <span class="domain-icon">&#9729;&#65039;</span>
      <div class="domain-meta">
        <span class="domain-name">Cloud Infrastructure</span>
        <span class="domain-platform">AWS &middot; GCP &middot; Azure</span>
      </div>
    </div>
    <p class="domain-desc">Multi-cloud architectures, VPCs, IAM, auto-scaling and cost governance for production workloads.</p>
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
        <span class="domain-name">Infrastructure as Code</span>
        <span class="domain-platform">Terraform &middot; Ansible &middot; Helm &middot; Packer</span>
      </div>
    </div>
    <p class="domain-desc">Versioned, repeatable infrastructure lifecycles. Declarative everything, environment-agnostic always.</p>
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
        <span class="domain-name">CI/CD Pipelines</span>
        <span class="domain-platform">GitHub Actions &middot; GitLab CI &middot; Tekton &middot; CircleCI</span>
      </div>
    </div>
    <p class="domain-desc">End-to-end delivery from commit to production. Fast, auditable and fully automated release flows.</p>
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
        <span class="domain-name">Containers &amp; Orchestration</span>
        <span class="domain-platform">Docker &middot; Kubernetes &middot; Service Mesh &middot; Operators</span>
      </div>
    </div>
    <p class="domain-desc">Containerized workloads at scale. GitOps-driven deployments with full lifecycle traceability.</p>
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
        <span class="domain-name">Monitoring &amp; Observability</span>
        <span class="domain-platform">Prometheus &middot; Grafana &middot; Datadog &middot; Dynatrace</span>
      </div>
    </div>
    <p class="domain-desc">Full-stack observability. Metrics, logs, traces and proactive alerting with SLO/SLA tracking.</p>
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
        <span class="domain-name">Security &amp; DevSecOps</span>
        <span class="domain-platform">Secrets Management &middot; Policy as Code &middot; Supply Chain</span>
      </div>
    </div>
    <p class="domain-desc">Security embedded at every pipeline stage. Shift-left scanning, policy-as-code and secrets management.</p>
    <div class="domain-tools">
      <span class="tech-badge">DevSecOps Pipelines</span>
      <span class="tech-badge">Secrets Management</span>
      <span class="tech-badge">Policy as Code</span>
      <span class="tech-badge">Vulnerability Scanning</span>
      <span class="tech-badge">Identity &amp; Access</span>
      <span class="tech-badge">Supply Chain Security</span>
    </div>
  </a>

</div>

---

## Explore

<div class="section-nav-grid">
  <a href="guides/" class="section-nav-card">
    <div class="snc-icon">&#128216;</div>
    <div class="snc-body">
      <span class="snc-label">Guides</span>
      <span class="snc-desc">Deep-dive technical guides on architecture patterns, tooling and DevOps best practices.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="tutorials/" class="section-nav-card">
    <div class="snc-icon">&#9881;&#65039;</div>
    <div class="snc-body">
      <span class="snc-label">Tutorials</span>
      <span class="snc-desc">Step-by-step walkthroughs from local setup to production-grade deployments.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="blog/" class="section-nav-card">
    <div class="snc-icon">&#9997;&#65039;</div>
    <div class="snc-body">
      <span class="snc-label">Blog</span>
      <span class="snc-desc">Thoughts, war stories and lessons learned from real-world DevOps engineering.</span>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
</div>

---

## Latest

<div class="latest-grid">

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-iac">Infrastructure</span>
      <span class="latest-date">Coming soon</span>
    </div>
    <h3 class="latest-title">Terraform at Scale: Module Design Patterns</h3>
    <p class="latest-excerpt">How to design reusable, versioned Terraform modules that work across multiple environments and teams without drift.</p>
    <a class="latest-link" href="blog/">Read more &#8594;</a>
  </div>

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-containers">Kubernetes</span>
      <span class="latest-date">Coming soon</span>
    </div>
    <h3 class="latest-title">GitOps Workflows with ArgoCD and Helm</h3>
    <p class="latest-excerpt">Building a production-ready GitOps pipeline that keeps your cluster state always in sync with your Git repository.</p>
    <a class="latest-link" href="blog/">Read more &#8594;</a>
  </div>

  <div class="latest-card">
    <div class="latest-card-meta">
      <span class="latest-tag tag-monitoring">Observability</span>
      <span class="latest-date">Coming soon</span>
    </div>
    <h3 class="latest-title">SLOs, Error Budgets and Grafana Dashboards</h3>
    <p class="latest-excerpt">Implementing service-level objectives from scratch with Prometheus recording rules and Grafana alerting workflows.</p>
    <a class="latest-link" href="blog/">Read more &#8594;</a>
  </div>

</div>
