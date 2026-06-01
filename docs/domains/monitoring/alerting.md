---
title: Alerting
description: Configuração do Alertmanager, árvores de roteamento, SLOs, orçamentos de erro, padrões de plantão e runbooks.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoramento-observabilidade / alerting</span>
    <h1 class="dph-title">Alerting</h1>
    <p class="dph-desc">Alertas eficazes são sobre sinal acima do ruído. O Alertmanager roteia, deduplica, agrupa e silencia alertas. SLOs definem metas de confiabilidade; orçamentos de erro tornam as decisões de queima orientadas por dados. Bons runbooks e práticas de plantão transformam alertas em resolução rápida.</p>
    <div class="dph-badges">
      <span class="tech-badge">Alertmanager</span>
      <span class="tech-badge">PagerDuty</span>
      <span class="tech-badge">SLOs</span>
      <span class="tech-badge">Orçamentos de Erro</span>
      <span class="tech-badge">Runbooks</span>
      <span class="tech-badge">On-Call</span>
    </div>
  </div>
</div>

[← OpenTelemetry](opentelemetry.md) | [← Visão Geral de Monitoramento](index.md) | [APM →](apm.md)

---

## Configuração do Alertmanager

```yaml
# alertmanager.yaml — configuração completa de produção
global:
  resolve_timeout: 5m
  pagerduty_url: https://events.pagerduty.com/v2/enqueue
  slack_api_url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Templates para mensagens de notificação
templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  group_by: [alertname, cluster, namespace]
  group_wait: 30s          # tempo de espera antes de enviar a primeira notificação
  group_interval: 5m       # tempo de espera antes de enviar alertas reagrupados
  repeat_interval: 4h      # renotifica se o alerta ainda estiver disparando
  receiver: default-slack  # pega-tudo

  routes:
    # Alertas críticos → PagerDuty imediatamente
    - matchers:
        - severity = critical
      receiver: pagerduty-critical
      group_wait: 0s
      repeat_interval: 1h
      routes:
        # Alertas críticos de banco de dados → DBA de plantão
        - matchers:
            - team = dba
          receiver: pagerduty-dba

    # Alertas de aviso → Slack
    - matchers:
        - severity = warning
      receiver: slack-warnings
      repeat_interval: 12h

    # Watchdog / heartbeat — suprimir
    - matchers:
        - alertname = Watchdog
      receiver: "null"

    # Info — apenas no Slack, sem renotificação
    - matchers:
        - severity = info
      receiver: slack-info
      repeat_interval: 24h

receivers:
  - name: "null"

  - name: default-slack
    slack_configs:
      - channel: "#alerts"
        title: '{{ template "slack.title" . }}'
        text: '{{ template "slack.text" . }}'
        send_resolved: true

  - name: slack-warnings
    slack_configs:
      - channel: "#alerts-warning"
        title: '{{ template "slack.title" . }}'
        text: '{{ template "slack.text" . }}'
        send_resolved: true

  - name: slack-info
    slack_configs:
      - channel: "#alerts-info"
        send_resolved: false

  - name: pagerduty-critical
    pagerduty_configs:
      - routing_key: "${PD_INTEGRATION_KEY_CRITICAL}"
        severity: '{{ if eq .GroupLabels.severity "critical" }}critical{{ else }}warning{{ end }}'
        client: "Alertmanager"
        client_url: '{{ template "pagerduty.client_url" . }}'
        description: '{{ template "pagerduty.description" . }}'
        details:
          firing:     '{{ .Alerts.Firing | len }}'
          resolved:   '{{ .Alerts.Resolved | len }}'
          namespace:  '{{ .GroupLabels.namespace }}'
          runbook:    '{{ (index .Alerts 0).Annotations.runbook_url }}'

  - name: pagerduty-dba
    pagerduty_configs:
      - routing_key: "${PD_INTEGRATION_KEY_DBA}"
        severity: critical

inhibit_rules:
  # Suprime aviso se crítico disparar para o mesmo alertname + namespace
  - source_matchers: [severity = critical]
    target_matchers: [severity = warning]
    equal: [alertname, namespace]

  # Suprime tudo se o cluster estiver fora
  - source_matchers: [alertname = ClusterDown]
    target_matchers: [severity =~ "warning|critical"]
    equal: [cluster]
```

---

## Templates de Notificação de Alertas

```go
{{/* /etc/alertmanager/templates/slack.tmpl */}}

{{ define "slack.title" -}}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }} ({{ .Alerts.Firing | len }}){{ end }}]
{{ .GroupLabels.alertname }} — {{ .GroupLabels.namespace }}
{{- end }}

{{ define "slack.text" -}}
{{ range .Alerts }}
*Summary:* {{ .Annotations.summary }}
*Description:* {{ .Annotations.description }}
{{ if .Annotations.runbook_url }}*Runbook:* <{{ .Annotations.runbook_url }}|{{ .Annotations.runbook_url }}>{{ end }}
*Labels:*
  {{ range .Labels.SortedPairs }}• *{{ .Name }}:* {{ .Value }}
  {{ end }}
{{ end }}
{{- end }}

{{ define "pagerduty.description" -}}
{{ (index .Alerts 0).Annotations.summary }}
{{- end }}

{{ define "pagerduty.client_url" -}}
https://grafana.internal/alerting/list
{{- end }}
```

---

## SLOs e Orçamentos de Erro

### Definição de SLO

| Termo | Definição |
|------|-----------|
| **SLI** (Indicador de Nível de Serviço) | Medida quantitativa: taxa de sucesso das requisições, latência P99 |
| **SLO** (Objetivo de Nível de Serviço) | Meta: "99,9% das requisições têm sucesso em até 500 ms" |
| **SLA** (Acordo de Nível de Serviço) | Contrato de negócio; descumprimento tem consequências financeiras |
| **Orçamento de erro** | `1 - SLO`; quanta não confiabilidade está "orçada" |
| **Taxa de queima** | Com que velocidade o orçamento de erro está sendo consumido |

### Matemática do Orçamento de Erro

$$
\text{Error budget remaining} = \frac{\text{budget consumed} - \text{total budget}}{\text{total budget}}
$$

Para um SLO de 99,9% ao longo de 30 dias:

$$
\text{Total budget} = (1 - 0.999) \times 30 \times 24 \times 60 = 43.2 \text{ min}
$$

### PromQL — Taxa de Queima do SLO (método Google)

```promql
# SLI: taxa de sucesso das requisições
job:sli_success_rate:ratio5m =
  sum(rate(http_requests_total{status!~"5.."}[5m]))
  /
  sum(rate(http_requests_total[5m]))

# Queima rápida: janelas de 1h + 5min (x14.4 de queima do orçamento)
(
  (1 - job:sli_success_rate:ratio5m) / (1 - 0.999) > 14.4
  and
  (1 - job:sli_success_rate:ratio1h) / (1 - 0.999) > 14.4
)
```

### Sloth — SLO como Código

```yaml
# sloth.yaml — gera regras do Prometheus a partir da definição do SLO
version: prometheus/v1
service: my-api
labels:
  team: backend
slos:
  - name: requests-availability
    objective: 99.9
    description: "99,9% das requisições da API têm sucesso"
    sli:
      events:
        error_query: sum(rate(http_requests_total{status=~"5.."}[{{.window}}]))
        total_query: sum(rate(http_requests_total[{{.window}}]))
    alerting:
      name: APIHighErrorRate
      labels:
        category: availability
      annotations:
        runbook_url: https://wiki.internal/runbooks/api-errors
      page_alert:
        labels: { severity: critical }
      ticket_alert:
        labels: { severity: warning }
```

```bash
# Gera recording rules + alertas a partir da definição do SLO
sloth generate -i sloth.yaml -o generated-rules.yaml
kubectl apply -f generated-rules.yaml
```

---

## Fadiga de Alertas — Melhores Práticas

| Antipadrão | Solução |
|-------------|-----|
| Alertar a cada violação de métrica | Alertar sobre **impacto ao usuário** (taxa de erro, latência, disponibilidade) |
| Sem duração `for` | Use `for: 5m` para evitar picos transitórios |
| Link de runbook ausente | Sempre defina `annotations.runbook_url` |
| Alertar no mesmo sinal em múltiplos limiares | Use alertas de taxa de queima (rápida + lenta) |
| Aviso == crítico | Acione apenas para problemas acionáveis e urgentes |
| Sem regras de inibição | Suprima alertas filhos quando o pai disparar (ex.: cluster fora) |
| Silêncios ruidosos | Crie silêncios baseados em tempo para janelas de manutenção |

---

## Padrões de Plantão

### Política de Escalação do PagerDuty

```
Nível 1: Engenheiro de plantão primário (15 min para confirmar)
     ↓ (sem confirmação)
Nível 2: Secundário / gerente (30 min para confirmar)
     ↓ (sem confirmação)
Nível 3: Diretor / VP (escalação definitiva)
```

### Silêncio do Alertmanager (Janela de Manutenção)

```bash
# Silencia todos os alertas de namespace=production por 2 horas
amtool silence add \
  --alertmanager.url=http://alertmanager.monitoring.svc:9093 \
  --author="leo" \
  --comment="Manutenção planejada 02:00-04:00 UTC" \
  --duration=2h \
  'namespace="production"'

# Lista silêncios ativos
amtool silence query --alertmanager.url=http://alertmanager.monitoring.svc:9093

# Expira um silêncio
amtool silence expire <ID> --alertmanager.url=http://alertmanager.monitoring.svc:9093
```

### Template de Runbook

```markdown
# Alerta: HighErrorRate

## Visão Geral
A taxa de erros da API excedeu 5% por 5 minutos.

## Impacto
Usuários estão experienciando requisições com falha. Impacto na receita: ~$X/min.

## Diagnóstico
1. Verifique deployments recentes: `kubectl rollout history deployment/api -n production`
2. Veja logs de erro: `{app="api"} |= "ERROR" | json` no Grafana Explore
3. Verifique conectividade do banco: `kubectl exec -it deploy/api -- nc -zv db.internal 5432`
4. Examine traces: filtre por `status=ERROR` no Tempo

## Mitigação
- **Se deploy ruim**: `kubectl rollout undo deployment/api -n production`
- **Se problema de banco**: notifique a equipe DBA, verifique o painel de métricas do banco
- **Se upstream**: verifique as páginas de status das dependências, habilite o circuit breaker

## Escalação
- Não resolvido em 30 min → acione o gerente de engenharia
- Perda de dados suspeita → acione imediatamente o DBA de plantão + segurança

## Pós-incidente
- Registre o relatório de incidente em até 24 horas
- Atualize este runbook com as descobertas
```

---

## Grafana OnCall (OSS)

```bash
helm upgrade --install oncall grafana/oncall \
  --namespace monitoring \
  --set base_url=https://oncall.internal \
  --set grafana.enabled=false \
  --set grafana.grafanaUrl=http://grafana.monitoring.svc
```

Principais recursos:

| Recurso | Descrição |
|---------|-------------|
| Schedules | Escalas de plantão baseadas em rotação com substituições |
| Escalation chains | Escalação baseada em tempo com múltiplos responsáveis |
| Integrations | Alertmanager, Grafana Alerting, PagerDuty, Opsgenie |
| Mobile app | Notificações push com ações de confirmação/resolução |
| ChatOps | Integração com Slack + Telegram |
| Postmortems | Visão de linha do tempo de incidentes com anotações |

[← OpenTelemetry](opentelemetry.md) | [← Visão Geral de Monitoramento](index.md) | [APM →](apm.md)
