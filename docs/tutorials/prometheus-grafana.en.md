---
title: "Tutorial: Monitoring Stack with Prometheus and Grafana"
description: "Build a complete observability stack with Prometheus, Grafana and Alertmanager from scratch using Docker Compose. Create real dashboards and alerts."
---

# Monitoring Stack with Prometheus and Grafana

You'll configure a complete observability stack using Docker Compose: Prometheus collects metrics from the host and containers, Grafana visualises them in dashboards, and Alertmanager fires alerts based on PromQL rules.

**Estimated time:** 60 minutes &nbsp;·&nbsp; **Level:** Intermediate

---

## Prerequisites

- Docker 24+ and Docker Compose v2+
- Ports `3000`, `9090` and `9093` available
- Basic command-line familiarity

---

## Project Structure

```
monitoring-stack/
├── docker-compose.yml
├── .env
├── prometheus/
│   ├── prometheus.yml
│   └── rules/
│       └── alerts.yml
└── grafana/
    └── provisioning/
        ├── datasources/
        │   └── prometheus.yml
        └── dashboards/
            └── dashboards.yml
```

```bash
mkdir -p monitoring-stack/{prometheus/rules,grafana/provisioning/{datasources,dashboards}}
cd monitoring-stack
```

---

## 1. Prometheus Configuration

**`prometheus/prometheus.yml`**

```yaml
global:
  scrape_interval:     15s   # collect metrics every 15s
  evaluation_interval: 15s   # evaluate alert rules every 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

rule_files:
  - "rules/*.yml"

scrape_configs:
  # Prometheus itself
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]

  # Node Exporter — host metrics (CPU, memory, disk, network)
  - job_name: "node"
    static_configs:
      - targets: ["node-exporter:9100"]

  # cAdvisor — metrics for all running containers
  - job_name: "cadvisor"
    static_configs:
      - targets: ["cadvisor:8080"]
```

---

## 2. Alert Rules

**`prometheus/rules/alerts.yml`**

```yaml
groups:
  - name: host.rules
    rules:
      - alert: HighCPULoad
        expr: >
          100 - (avg by(instance)
            (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU on {{ $labels.instance }}"
          description: >
            CPU above 80% for more than 5 minutes
            (current value: {{ $value | printf "%.1f" }}%)

      - alert: HighMemoryUsage
        expr: >
          (1 - (node_memory_MemAvailable_bytes /
                node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Critical memory on {{ $labels.instance }}"
          description: >
            Memory usage above 85%
            (current value: {{ $value | printf "%.1f" }}%)

      - alert: DiskSpaceLow
        expr: >
          (1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} /
                node_filesystem_size_bytes)) * 100 > 80
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disk almost full on {{ $labels.instance }}"
          description: >
            Mount point {{ $labels.mountpoint }} at
            {{ $value | printf "%.1f" }}% usage

      - alert: ContainerDown
        expr: absent(container_last_seen{name!=""})
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Container stopped responding"
          description: "Container {{ $labels.name }} not seen for over 1 minute"
```

---

## 3. Grafana — Automatic Provisioning

With provisioning, datasources and dashboards are configured without manual intervention when the container starts.

**`grafana/provisioning/datasources/prometheus.yml`**

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
```

**`grafana/provisioning/dashboards/dashboards.yml`**

```yaml
apiVersion: 1

providers:
  - name: Default
    orgId: 1
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
```

---

## 4. Docker Compose

**`.env`**

```bash
GRAFANA_PASSWORD=admin
```

**`docker-compose.yml`**

```yaml
services:
  prometheus:
    image: prom/prometheus:v2.51.2
    volumes:
      - ./prometheus:/etc/prometheus
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
      - "--web.enable-lifecycle"       # allows config reload without restart
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:10.4.2
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    ports:
      - "3000:3000"
    depends_on:
      - prometheus
    restart: unless-stopped

  alertmanager:
    image: prom/alertmanager:v0.27.0
    ports:
      - "9093:9093"
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:v1.8.0
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - "--path.procfs=/host/proc"
      - "--path.sysfs=/host/sys"
      - "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)"
    pid: host
    restart: unless-stopped

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:v0.49.1
    privileged: true
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
    restart: unless-stopped

volumes:
  prometheus_data:
  grafana_data:
```

---

## 5. Start the Stack

```bash
# Start all services
docker compose up -d

# Check that all services are healthy
docker compose ps

# Follow Prometheus logs
docker compose logs -f prometheus
```

| Service | URL | Credentials |
|---|---|---|
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |

---

## 6. Verify Metric Collection

In the Prometheus UI (http://localhost:9090):

1. **Status → Targets** — all targets should be `UP`
2. **Status → Rules** — alert rules should be loaded
3. Run a test query:

```promql
up
```

If it returns `1` for each target, collection is working.

---

## 7. Import a Dashboard in Grafana

1. Go to **Dashboards → New → Import**
2. Enter ID `1860` (Node Exporter Full — most popular community dashboard)
3. Select the **Prometheus** datasource
4. Click **Import**

You'll instantly have a full dashboard with CPU, memory, disk and network metrics.

Other useful dashboards:

| Dashboard | ID | Monitors |
|---|---|---|
| Node Exporter Full | `1860` | Full host |
| cAdvisor | `14282` | Containers |
| Prometheus Stats | `358` | Prometheus itself |
| Alertmanager | `9578` | Active alerts |

---

## 8. Essential PromQL Queries

```promql
# % CPU in use (average over last 5 minutes)
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# % memory in use
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# % disk usage per mount point
(1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100

# Network bytes received (last 5m)
rate(node_network_receive_bytes_total{device!="lo"}[5m])

# Number of running containers
count(container_last_seen{name!=""})

# Reload Prometheus config without restart
curl -X POST http://localhost:9090/-/reload
```

---

## 9. Configure Alertmanager

To receive alerts via Slack or email, create `alertmanager/alertmanager.yml`:

```yaml
global:
  slack_api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'

route:
  group_by: ['alertname', 'severity']
  group_wait:      30s
  group_interval:  5m
  repeat_interval: 12h
  receiver: 'slack-critical'
  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
    - match:
        severity: warning
      receiver: 'slack-warning'

receivers:
  - name: 'slack-critical'
    slack_configs:
      - channel: '#alerts-critical'
        title: '🔴 {{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'

  - name: 'slack-warning'
    slack_configs:
      - channel: '#alerts-warning'
        title: '⚠️ {{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'
```

Mount the file in Compose:

```yaml
alertmanager:
  image: prom/alertmanager:v0.27.0
  volumes:
    - ./alertmanager:/etc/alertmanager   # add this line
  command:
    - "--config.file=/etc/alertmanager/alertmanager.yml"
  ports:
    - "9093:9093"
```

---

## Next Steps

- [Prometheus — Full Reference](../domains/monitoring/prometheus.md)
- [Grafana — Dashboards and Alerts](../domains/monitoring/grafana.md)
- [OpenTelemetry — Advanced Instrumentation](../domains/monitoring/opentelemetry.md)
- [Alerting — Strategies and Best Practices](../domains/monitoring/alerting.md)
