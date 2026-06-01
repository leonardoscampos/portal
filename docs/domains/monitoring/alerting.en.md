---
title: Alerting
description: Alertmanager configuration, routing trees, SLOs, error budgets, on-call patterns, and runbooks.
---

<div class="domain-page-hero" data-domain="monitoring">
  <div class="dph-left">
    <span class="dph-eyebrow">// monitoring-observability / alerting</span>
    <h1 class="dph-title">Alerting</h1>
    <p class="dph-desc">Effective alerting is about signal over noise. Alertmanager routes, deduplicates, groups, and silences alerts. SLOs define reliability targets; error budgets make burn decisions data-driven. Good runbooks and on-call practices turn alerts into rapid resolution.</p>
    <div class="dph-badges">
      <span class="tech-badge">Alertmanager</span>
      <span class="tech-badge">PagerDuty</span>
      <span class="tech-badge">SLOs</span>
      <span class="tech-badge">Error Budgets</span>
      <span class="tech-badge">Runbooks</span>
      <span class="tech-badge">On-Call</span>
    </div>
  </div>
</div>

[← OpenTelemetry](opentelemetry.md) | [← Monitoring Overview](index.md) | [APM →](apm.md)

---

## Alertmanager Configuration

```yaml
# alertmanager.yaml — full production config
global:
  resolve_timeout: 5m
  pagerduty_url: https://events.pagerduty.com/v2/enqueue
  slack_api_url: https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Templates for notification messages
templates:
  - /etc/alertmanager/templates/*.tmpl

route:
  group_by: [alertname, cluster, namespace]
  group_wait: 30s          # buffer time before sending first notification
  group_interval: 5m       # time to wait before sending re-grouped alerts
  repeat_interval: 4h      # re-notify if alert is still firing
  receiver: default-slack  # catch-all

  routes:
    # Critical alerts → PagerDuty immediately
    - matchers:
        - severity = critical
      receiver: pagerduty-critical
      group_wait: 0s
      repeat_interval: 1h
      routes:
        # Database critical alerts → DBA on-call
        - matchers:
            - team = dba
          receiver: pagerduty-dba

    # Warning alerts → Slack
    - matchers:
        - severity = warning
      receiver: slack-warnings
      repeat_interval: 12h

    # Watchdog / heartbeat — suppress
    - matchers:
        - alertname = Watchdog
      receiver: "null"

    # Info — only in Slack, no re-notify
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
  # Suppress warning if critical fires for same alertname + namespace
  - source_matchers: [severity = critical]
    target_matchers: [severity = warning]
    equal: [alertname, namespace]

  # Suppress all if cluster is down
  - source_matchers: [alertname = ClusterDown]
    target_matchers: [severity =~ "warning|critical"]
    equal: [cluster]
```

---

## Alert Notification Templates

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

## SLOs and Error Budgets

### SLO Definition

| Term | Definition |
|------|-----------|
| **SLI** (Service Level Indicator) | Quantitative measure: request success rate, P99 latency |
| **SLO** (Service Level Objective) | Target: "99.9% of requests succeed within 500 ms" |
| **SLA** (Service Level Agreement) | Business contract; breach has financial consequences |
| **Error budget** | `1 - SLO`; how much unreliability is "budgeted" |
| **Burn rate** | How fast the error budget is being consumed |

### Error Budget Maths

$$
\text{Error budget remaining} = \frac{\text{budget consumed} - \text{total budget}}{\text{total budget}}
$$

For a 99.9% SLO over 30 days:

$$
\text{Total budget} = (1 - 0.999) \times 30 \times 24 \times 60 = 43.2 \text{ min}
$$

### PromQL — SLO Burn Rate (Google method)

```promql
# SLI: request success rate
job:sli_success_rate:ratio5m =
  sum(rate(http_requests_total{status!~"5.."}[5m]))
  /
  sum(rate(http_requests_total[5m]))

# Fast burn: 1h + 5min windows (x14.4 budget burn)
(
  (1 - job:sli_success_rate:ratio5m) / (1 - 0.999) > 14.4
  and
  (1 - job:sli_success_rate:ratio1h) / (1 - 0.999) > 14.4
)
```

### Sloth — SLO-as-Code

```yaml
# sloth.yaml — generates Prometheus rules from SLO definition
version: prometheus/v1
service: my-api
labels:
  team: backend
slos:
  - name: requests-availability
    objective: 99.9
    description: "99.9% of API requests succeed"
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
# Generate recording rules + alerts from SLO definition
sloth generate -i sloth.yaml -o generated-rules.yaml
kubectl apply -f generated-rules.yaml
```

---

## Alert Fatigue — Best Practices

| Anti-pattern | Fix |
|-------------|-----|
| Alert on every metric breach | Alert on **user impact** (error rate, latency, availability) |
| No `for` duration | Use `for: 5m` to avoid transient spikes |
| Missing runbook link | Always set `annotations.runbook_url` |
| Alerting on the same signal at multiple thresholds | Use burn rate alerts (fast + slow) instead |
| Warning == critical | Only page for actionable, urgent issues |
| No inhibition rules | Suppress child alerts when parent fires (e.g. cluster down) |
| Noisy silences | Create time-based silences for maintenance windows |

---

## On-Call Patterns

### PagerDuty Escalation Policy

```
Level 1: Primary on-call engineer (15 min to ack)
     ↓ (no ack)
Level 2: Secondary / manager (30 min to ack)
     ↓ (no ack)
Level 3: Director / VP (hard escalation)
```

### Alertmanager Silence (Maintenance Window)

```bash
# Silence all alerts for namespace=production for 2 hours
amtool silence add \
  --alertmanager.url=http://alertmanager.monitoring.svc:9093 \
  --author="leo" \
  --comment="Planned maintenance 02:00-04:00 UTC" \
  --duration=2h \
  'namespace="production"'

# List active silences
amtool silence query --alertmanager.url=http://alertmanager.monitoring.svc:9093

# Expire a silence
amtool silence expire <ID> --alertmanager.url=http://alertmanager.monitoring.svc:9093
```

### Runbook Template

```markdown
# Alert: HighErrorRate

## Overview
The API error rate has exceeded 5% for 5 minutes.

## Impact
Users are experiencing failed requests. Revenue impact: ~$X/min.

## Diagnosis
1. Check recent deployments: `kubectl rollout history deployment/api -n production`
2. View error logs: `{app="api"} |= "ERROR" | json` in Grafana Explore
3. Check DB connectivity: `kubectl exec -it deploy/api -- nc -zv db.internal 5432`
4. Examine traces: filter by `status=ERROR` in Tempo

## Mitigation
- **If bad deploy**: `kubectl rollout undo deployment/api -n production`
- **If DB issue**: notify DBA team, check DB metrics dashboard
- **If upstream**: check dependency status pages, enable circuit breaker

## Escalation
- Unresolved in 30 min → page engineering manager
- Data loss suspected → immediately page on-call DBA + security

## Post-incident
- File incident report within 24 hours
- Update this runbook with findings
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

Key features:

| Feature | Description |
|---------|-------------|
| Schedules | Rotation-based on-call schedules with overrides |
| Escalation chains | Time-based escalation with multiple responders |
| Integrations | Alertmanager, Grafana Alerting, PagerDuty, Opsgenie |
| Mobile app | Push notifications with ack/resolve actions |
| ChatOps | Slack + Telegram integration |
| Postmortems | Timeline view of incidents with annotations |

[← OpenTelemetry](opentelemetry.md) | [← Monitoring Overview](index.md) | [APM →](apm.md)
