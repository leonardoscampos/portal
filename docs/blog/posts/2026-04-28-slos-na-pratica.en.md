---
date: 2026-04-28
authors:
  - leonardoscampos
categories:
  - Observability
tags:
  - slo
  - sre
  - prometheus
  - monitoring
---

# SLOs in Practice: Stop Monitoring Metrics, Start Monitoring Reliability

Most teams monitor everything: CPU, memory, p99 latency, error rate, disk... and still find out about problems from user complaints. The issue isn't a lack of metrics — it's a lack of focus. SLOs (Service Level Objectives) fix that.

<!-- more -->

## The difference between alerting and measuring reliability

**Traditional alert**: "CPU > 80% for 5 minutes" → pages on-call.

**SLO**: "99.5% of requests must have latency < 300ms over the last 30 days" → pages only when the user is actually impacted.

The first creates alert fatigue. The second alerts when it matters.

## The three components of an SLO

### 1. SLI — Service Level Indicator

The metric that represents the user's experience. The most common:

| SLI Type | Metric | Example |
|---|---|---|
| Availability | `successes / total` | HTTP 2xx / total requests |
| Latency | Duration percentile | p99 < 500ms |
| Freshness | Time since last update | Data less than 5 min old |
| Throughput | Requests processed | > 1000 req/s |

### 2. SLO — the objective

```
Availability: 99.5% of requests with 2xx status over the last 30 days
Latency:      95% of requests with latency < 200ms over the last 7 days
```

!!! tip "Start conservative"
    A 99.9% SLO looks great on paper but is extremely hard to maintain. Start with 99% or 99.5% and adjust based on the reality of your system.

### 3. Error Budget — the tolerance reserve

The error budget is how much you can "fail" before violating the SLO.

```
SLO: 99.5% availability over 30 days
Total minutes: 30 × 24 × 60 = 43,200 minutes
Error budget: 0.5% × 43,200 = 216 minutes of allowed downtime
```

## Implementing with Prometheus

```yaml
# SLI: HTTP success rate
- record: job:http_requests:success_rate5m
  expr: |
    sum(rate(http_requests_total{status=~"2.."}[5m])) by (job)
    /
    sum(rate(http_requests_total[5m])) by (job)

# Burn rate: speed at which the error budget is being consumed
- record: job:http_requests:error_budget_burn_rate1h
  expr: |
    1 - job:http_requests:success_rate5m
    /
    (1 - 0.995)   # 1 - SLO target
```

## Burn-rate-based alerts

Alert when the SLO is *going to be* violated, not after it already has been:

```yaml
groups:
  - name: slo-alerts
    rules:
      # Burning budget too fast (2% in 1h = violation in 2 days)
      - alert: SLOBurnRateCritical
        expr: job:http_requests:error_budget_burn_rate1h > 14.4
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error budget being consumed 14x above normal"
          description: "At this rate, the SLO will be violated in {{ $value | humanizeDuration }}"

      # Moderate burn rate (early warning)
      - alert: SLOBurnRateWarning
        expr: job:http_requests:error_budget_burn_rate1h > 6
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Error budget being consumed above expected rate"
```

!!! note "Why 14.4?"
    With a 30-day SLO, a burn rate of 14.4x means the entire budget will be consumed in ~2 days. That's the threshold where it's worth waking someone up at 3am.

## Error Budget Policy: what to do when the budget runs out

Without a clear policy, the SLO becomes a decorative number. Define it upfront:

| Budget remaining | Action |
|---|---|
| > 50% | Normal work — features and improvements |
| 25–50% | Increase focus on reliability |
| 10–25% | Freeze new features, full focus on stability |
| < 10% | Deploy freeze until budget is recovered |

## Grafana Dashboard: visibility for the team

A good SLO dashboard should show:

1. **Current SLO** vs target (e.g. 99.7% vs 99.5% target)
2. **Remaining error budget** as % and as absolute time
3. **Burn rate** over the last 1h, 6h, 24h
4. **Violation history** over the last 90 days

## Conclusion

SLOs changed how my team communicates with stakeholders. Instead of "the system is slow", we say "we consumed 40% of our error budget this month — we need to decide: do we ship the new feature or prioritise reliability?".

This makes conversations about reliability objective and data-driven. Try starting with one critical service, defining a simple availability SLO, and measuring for 30 days. The result will surprise you.
