---
title: Monitoramento & Observabilidade
description: Prometheus, Grafana, Loki, OpenTelemetry, Alertas e APM — referência para engenheiros DevOps.
hide:
  - toc
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade</span>
    <h1 class="dph-title">Monitoramento &amp; Observabilidade</h1>
    <p class="dph-desc">Visibilidade full-stack em cada camada da sua plataforma. Métricas, logs, traces e alertas proativos — os três pilares da observabilidade — interligados com as ferramentas open-source e cloud-native mais adotadas da indústria.</p>
    <div class="dph-badges">
      <a href="prometheus/" class="tech-badge">Prometheus</a>
      <a href="grafana/" class="tech-badge">Grafana</a>
      <a href="loki/" class="tech-badge">Loki</a>
      <a href="opentelemetry/" class="tech-badge">OpenTelemetry</a>
      <a href="alerting/" class="tech-badge">Alerting</a>
      <a href="apm/" class="tech-badge">APM</a>
      <a href="datadog/" class="tech-badge">Datadog</a>
      <a href="dynatrace/" class="tech-badge">Dynatrace</a>
      <a href="elk/" class="tech-badge">ELK Stack</a>
    </div>
  </div>
</div>

---

<div class="section-nav-grid">
  <a href="prometheus/" class="section-nav-card">
    <div class="snc-icon">&#128293;</div>
    <div class="snc-body">
      <span class="snc-label">Prometheus</span>
      <span class="snc-desc">Coleta de métricas, PromQL, recording rules, Prometheus Operator e remote write.</span>
      <div class="snc-badges"><span class="tech-badge">PromQL</span><span class="tech-badge">Alertmanager</span><span class="tech-badge">Operator</span><span class="tech-badge">Remote Write</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="grafana/" class="section-nav-card">
    <div class="snc-icon">&#128202;</div>
    <div class="snc-body">
      <span class="snc-label">Grafana</span>
      <span class="snc-desc">Dashboards, fontes de dados, alertas, provisionamento, Grafana Agent e stack LGTM.</span>
      <div class="snc-badges"><span class="tech-badge">Dashboards</span><span class="tech-badge">Grafana Agent</span><span class="tech-badge">Provisioning</span><span class="tech-badge">LGTM</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="loki/" class="section-nav-card">
    <div class="snc-icon">&#128221;</div>
    <div class="snc-body">
      <span class="snc-label">Loki</span>
      <span class="snc-desc">Agregação de logs, LogQL, Promtail, Alloy, armazenamento em chunks e métricas baseadas em logs.</span>
      <div class="snc-badges"><span class="tech-badge">LogQL</span><span class="tech-badge">Promtail</span><span class="tech-badge">Alloy</span><span class="tech-badge">Ruler</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="opentelemetry/" class="section-nav-card">
    <div class="snc-icon">&#128301;</div>
    <div class="snc-body">
      <span class="snc-label">OpenTelemetry</span>
      <span class="snc-desc">OTel SDK, Collector, traces, métricas, logs — instrumentação neutra em relação ao vendor.</span>
      <div class="snc-badges"><span class="tech-badge">OTel Collector</span><span class="tech-badge">Traces</span><span class="tech-badge">Metrics</span><span class="tech-badge">SDK</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="alerting/" class="section-nav-card">
    <div class="snc-icon">&#128276;</div>
    <div class="snc-body">
      <span class="snc-label">Alertas</span>
      <span class="snc-desc">Alertmanager, PagerDuty, SLOs, error budgets, runbooks e padrões de plantão.</span>
      <div class="snc-badges"><span class="tech-badge">Alertmanager</span><span class="tech-badge">PagerDuty</span><span class="tech-badge">SLO</span><span class="tech-badge">Runbooks</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="apm/" class="section-nav-card">
    <div class="snc-icon">&#9878;&#65039;</div>
    <div class="snc-body">
      <span class="snc-label">APM</span>
      <span class="snc-desc">Jaeger, Tempo, Elastic APM, Datadog, New Relic — rastreamento distribuído e APM.</span>
      <div class="snc-badges"><span class="tech-badge">Jaeger</span><span class="tech-badge">Tempo</span><span class="tech-badge">Elastic APM</span><span class="tech-badge">Pyroscope</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="datadog/" class="section-nav-card">
    <div class="snc-icon">&#128021;</div>
    <div class="snc-body">
      <span class="snc-label">Datadog</span>
      <span class="snc-desc">Observabilidade unificada — infraestrutura, APM, logs, RUM, synthetics e SLOs.</span>
      <div class="snc-badges"><span class="tech-badge">Datadog Agent</span><span class="tech-badge">APM</span><span class="tech-badge">Monitors</span><span class="tech-badge">SLOs</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="dynatrace/" class="section-nav-card">
    <div class="snc-icon">&#129302;</div>
    <div class="snc-body">
      <span class="snc-label">Dynatrace</span>
      <span class="snc-desc">Observabilidade full-stack com IA — OneAgent, Davis AI, Smartscape e DQL.</span>
      <div class="snc-badges"><span class="tech-badge">OneAgent</span><span class="tech-badge">Davis AI</span><span class="tech-badge">Smartscape</span><span class="tech-badge">DQL</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
  <a href="elk/" class="section-nav-card">
    <div class="snc-icon">&#128269;</div>
    <div class="snc-body">
      <span class="snc-label">ELK Stack</span>
      <span class="snc-desc">Elasticsearch, Logstash, Kibana e Beats — gerenciamento centralizado de logs e pesquisa.</span>
      <div class="snc-badges"><span class="tech-badge">Elasticsearch</span><span class="tech-badge">Logstash</span><span class="tech-badge">Kibana</span><span class="tech-badge">Fleet</span></div>
    </div>
    <span class="snc-arrow">&#8594;</span>
  </a>
</div>
