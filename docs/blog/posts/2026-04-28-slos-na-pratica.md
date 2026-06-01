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
  - monitoramento
---

# SLOs na Prática: Pare de Monitorar Métricas, Comece a Monitorar Confiabilidade

A maioria dos times monitora tudo: CPU, memória, latência p99, taxa de erros, disco... e ainda assim descobre problemas pela reclamação do usuário. O problema não é falta de métricas — é falta de foco. SLOs (Service Level Objectives) resolvem isso.

<!-- more -->

## A diferença entre alertar e medir confiabilidade

**Alerta tradicional**: "CPU > 80% por 5 minutos" → página o plantão.

**SLO**: "99,5% das requisições devem ter latência < 300ms nos últimos 30 dias" → página só quando o usuário está sendo impactado.

O primeiro cria fadiga de alertas. O segundo alerta quando importa.

## Os três componentes de um SLO

### 1. SLI — Service Level Indicator

A métrica que representa a experiência do usuário. Os mais comuns:

| Tipo de SLI | Métrica | Exemplo |
|-------------|---------|---------|
| Disponibilidade | `sucessos / total` | HTTP 2xx / total de requests |
| Latência | Percentil de duração | p99 < 500ms |
| Freshness | Tempo desde última atualização | Dados com menos de 5 min |
| Throughput | Requisições processadas | > 1000 req/s |

### 2. SLO — o objetivo

```
Disponibilidade: 99,5% das requisições com status 2xx nos últimos 30 dias
Latência:        95% das requisições com latência < 200ms nos últimos 7 dias
```

!!! tip "Comece conservador"
    Um SLO de 99,9% parece ótimo no papel mas é extremamente difícil de manter. Comece com 99% ou 99,5% e ajuste conforme a realidade do sistema.

### 3. Error Budget — a reserva de tolerância

O error budget é o quanto você pode "errar" antes de violar o SLO.

```
SLO: 99,5% de disponibilidade em 30 dias
Total de minutos: 30 × 24 × 60 = 43.200 minutos
Error budget: 0,5% × 43.200 = 216 minutos de indisponibilidade permitidos
```

## Implementando com Prometheus

```yaml
# SLI: taxa de sucesso HTTP
- record: job:http_requests:success_rate5m
  expr: |
    sum(rate(http_requests_total{status=~"2.."}[5m])) by (job)
    /
    sum(rate(http_requests_total[5m])) by (job)

# Burn rate: velocidade de consumo do error budget
- record: job:http_requests:error_budget_burn_rate1h
  expr: |
    1 - job:http_requests:success_rate5m
    /
    (1 - 0.995)   # 1 - SLO target
```

## Alertas baseados em burn rate

Alertar quando o SLO vai ser violado, não quando já foi:

```yaml
groups:
  - name: slo-alerts
    rules:
      # Consumindo budget muito rápido (2% em 1h = viola em 2 dias)
      - alert: SLOBurnRateCritical
        expr: job:http_requests:error_budget_burn_rate1h > 14.4
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Error budget sendo consumido 14x acima do normal"
          description: "Ao ritmo atual, o SLO será violado em {{ $value | humanizeDuration }}"

      # Burn rate moderado (alerta com antecedência)
      - alert: SLOBurnRateWarning
        expr: job:http_requests:error_budget_burn_rate1h > 6
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Error budget sendo consumido acima do esperado"
```

!!! note "Por que 14.4?"
    Com SLO de 30 dias, um burn rate de 14.4x significa que o budget inteiro será consumido em ~2 dias. É o ponto onde vale a pena acordar alguém às 3h da manhã.

## Error Budget Policy: o que fazer quando o budget acaba

Sem uma política clara, o SLO vira número decorativo. Defina previamente:

| Budget restante | Ação |
|-----------------|------|
| > 50% | Trabalho normal — features e melhorias |
| 25–50% | Aumentar foco em confiabilidade |
| 10–25% | Congela features novas, foco total em estabilidade |
| < 10% | Freeze de deploys até recuperar budget |

## Dashboard Grafana: visibilidade para o time

Um bom dashboard de SLO deve mostrar:

1. **SLO atual** vs target (ex: 99,7% vs 99,5% target)
2. **Error budget restante** em % e em tempo absoluto
3. **Burn rate** nas últimas 1h, 6h, 24h
4. **Histórico de violações** nos últimos 90 dias

## Conclusão

SLOs mudaram como meu time se comunica com stakeholders. Em vez de "o sistema está lento", dizemos "consumimos 40% do nosso error budget este mês — precisamos decidir: deployamos a feature nova ou priorizamos confiabilidade?".

Isso torna a conversa sobre confiabilidade objetiva e orientada a dados. Experimente começar com um serviço crítico, definir um SLO simples de disponibilidade e medir por 30 dias. O resultado vai surpreender.
