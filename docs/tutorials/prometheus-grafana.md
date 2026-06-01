---
title: "Tutorial: Stack de Monitoramento com Prometheus e Grafana"
description: "Monte do zero uma stack de observabilidade com Prometheus, Grafana e Alertmanager usando Docker Compose. Crie dashboards e alertas reais."
---

# Stack de Monitoramento com Prometheus e Grafana

Você vai configurar uma stack completa de observabilidade usando Docker Compose: Prometheus coleta métricas de host e containers, Grafana visualiza em dashboards e Alertmanager dispara alertas baseados em regras PromQL.

**Tempo estimado:** 60 minutos &nbsp;·&nbsp; **Nível:** Intermediário

---

## Pré-requisitos

- Docker 24+ e Docker Compose v2+
- Portas `3000`, `9090` e `9093` livres
- Familiaridade básica com linha de comando

---

## Estrutura do Projeto

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

## 1. Configuração do Prometheus

**`prometheus/prometheus.yml`**

```yaml
global:
  scrape_interval:     15s   # coletar métricas a cada 15s
  evaluation_interval: 15s   # avaliar regras de alerta a cada 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

rule_files:
  - "rules/*.yml"

scrape_configs:
  # O próprio Prometheus
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]

  # Node Exporter — métricas do host (CPU, memória, disco, rede)
  - job_name: "node"
    static_configs:
      - targets: ["node-exporter:9100"]

  # cAdvisor — métricas de todos os containers em execução
  - job_name: "cadvisor"
    static_configs:
      - targets: ["cadvisor:8080"]
```

---

## 2. Regras de Alerta

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
          summary: "CPU alta em {{ $labels.instance }}"
          description: >
            CPU acima de 80% por mais de 5 minutos
            (valor atual: {{ $value | printf "%.1f" }}%)

      - alert: HighMemoryUsage
        expr: >
          (1 - (node_memory_MemAvailable_bytes /
                node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Memória crítica em {{ $labels.instance }}"
          description: >
            Uso de memória acima de 85%
            (valor atual: {{ $value | printf "%.1f" }}%)

      - alert: DiskSpaceLow
        expr: >
          (1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} /
                node_filesystem_size_bytes)) * 100 > 80
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Disco quase cheio em {{ $labels.instance }}"
          description: >
            Partição {{ $labels.mountpoint }} com
            {{ $value | printf "%.1f" }}% de uso

      - alert: ContainerDown
        expr: absent(container_last_seen{name!=""})
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Container parou de responder"
          description: "Container {{ $labels.name }} não é visto há mais de 1 minuto"
```

---

## 3. Grafana — Provisionamento Automático

Com provisionamento, datasources e dashboards são configurados sem intervenção manual ao subir o container.

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
      - "--web.enable-lifecycle"       # permite reload sem restart
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

## 5. Subir a Stack

```bash
# Subir todos os serviços
docker compose up -d

# Verificar se todos estão healthy
docker compose ps

# Acompanhar logs do Prometheus
docker compose logs -f prometheus
```

| Serviço | URL | Credenciais |
|---|---|---|
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| Alertmanager | http://localhost:9093 | — |

---

## 6. Verificar Coleta de Métricas

No Prometheus UI (http://localhost:9090):

1. **Status → Targets** — todos os targets devem estar `UP`
2. **Status → Rules** — regras de alerta devem estar carregadas
3. Executar uma query de teste:

```promql
up
```

Se retornar `1` para cada target, a coleta está funcionando.

---

## 7. Importar Dashboard no Grafana

1. Acesse **Dashboards → New → Import**
2. Insira o ID `1860` (Node Exporter Full — dashboard mais popular da comunidade)
3. Selecione o datasource **Prometheus**
4. Clique em **Import**

Você terá instantaneamente um dashboard completo com CPU, memória, disco e rede.

Outros dashboards úteis:

| Dashboard | ID | O que monitora |
|---|---|---|
| Node Exporter Full | `1860` | Host completo |
| cAdvisor | `14282` | Containers |
| Prometheus Stats | `358` | O próprio Prometheus |
| Alertmanager | `9578` | Alertas ativos |

---

## 8. PromQL — Queries Essenciais

```promql
# % de CPU em uso (média dos últimos 5 minutos)
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# % de memória em uso
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# % de uso de disco por ponto de montagem
(1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100

# Total de bytes de rede recebidos (últimas 5m)
rate(node_network_receive_bytes_total{device!="lo"}[5m])

# Número de containers rodando
count(container_last_seen{name!=""})

# Recarregar config do Prometheus sem restart
curl -X POST http://localhost:9090/-/reload
```

---

## 9. Configurar Alertmanager

Para receber alertas por e-mail ou Slack, crie `alertmanager/alertmanager.yml`:

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

Monte o arquivo no Compose:

```yaml
alertmanager:
  image: prom/alertmanager:v0.27.0
  volumes:
    - ./alertmanager:/etc/alertmanager   # adicionar esta linha
  command:
    - "--config.file=/etc/alertmanager/alertmanager.yml"
  ports:
    - "9093:9093"
```

---

## Próximos Passos

- [Prometheus — Referência Completa](../domains/monitoring/prometheus.md)
- [Grafana — Dashboards e Alertas](../domains/monitoring/grafana.md)
- [OpenTelemetry — Instrumentação Avançada](../domains/monitoring/opentelemetry.md)
- [Alerting — Estratégias e Boas Práticas](../domains/monitoring/alerting.md)
