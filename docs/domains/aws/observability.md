---
title: AWS Observabilidade
description: CloudWatch, X-Ray, CloudTrail, AWS Config, Cost Explorer — observabilidade na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / observability</span>
    <h1 class="dph-title">AWS Observabilidade</h1>
    <p class="dph-desc">Métricas, logs, traces, trilhas de auditoria e desvio de conformidade — a stack completa de observabilidade para cargas de trabalho AWS. Construída sobre o CloudWatch como plano de dados central, enriquecida com rastreamento X-Ray, auditoria CloudTrail e AWS Config para histórico de configurações.</p>
    <div class="dph-badges">
      <span class="tech-badge">CloudWatch</span>
      <span class="tech-badge">X-Ray</span>
      <span class="tech-badge">CloudTrail</span>
      <span class="tech-badge">AWS Config</span>
      <span class="tech-badge">Cost Explorer</span>
      <span class="tech-badge">Managed Prometheus</span>
    </div>
  </div>
</div>

---

## CloudWatch

O CloudWatch é a plataforma de observabilidade nativa da AWS cobrindo **métricas**, **logs**, **alarmes**, **dashboards** e **canários sintéticos**. Quase todo serviço AWS publica métricas no CloudWatch automaticamente.

### Fundamentos de métricas

| Conceito | Descrição |
|----------|-----------|
| **Namespace** | Agrupamento lógico: `AWS/EC2`, `AWS/ECS`, `AWS/ApplicationELB`, `CWAgent` |
| **Dimension** | Filtro chave-valor: `InstanceId=i-0abc123`, `ClusterName=prod` |
| **Metric** | O valor mensurável: `CPUUtilization`, `HTTPCode_Target_5XX_Count` |
| **Statistic** | Agregação: `Average`, `Sum`, `Maximum`, `p99` |
| **Period** | Janela de agregação: 1s / 10s / 30s / 60s / 5m / 1h |

### Alarmes

Os alarmes transitam entre `OK`, `ALARM` e `INSUFFICIENT_DATA`. As ações incluem notificações SNS, gatilhos de política de Auto Scaling e recuperação de instâncias EC2.

```hcl
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.project}-api-5xx-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.app.arn_suffix
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
```

### Alarmes compostos

Os alarmes compostos combinam múltiplos alarmes com lógica AND/OR, reduzindo ruído de alertas. Use-os para criar um único alarme de "saúde do serviço" que dispara apenas quando múltiplos sinais estão degradados simultaneamente.

```hcl
resource "aws_cloudwatch_composite_alarm" "service_degraded" {
  alarm_name = "${var.project}-service-degraded"

  alarm_rule = "ALARM(${aws_cloudwatch_metric_alarm.api_5xx.alarm_name}) AND ALARM(${aws_cloudwatch_metric_alarm.api_latency_p99.alarm_name})"

  alarm_actions = [aws_sns_topic.pagerduty.arn]
}
```

### Logs Insights

O CloudWatch Logs Insights é uma linguagem de consulta para pesquisar e analisar dados de log em grupos de log. Operadores principais:

```sql
-- Top 10 endpoints de API mais lentos na última hora
fields @timestamp, path, duration_ms
| filter status >= 200
| stats avg(duration_ms) as avg_ms, count() as requests by path
| sort avg_ms desc
| limit 10
```

```sql
-- Taxa de erros por serviço
fields @timestamp, service, level
| filter level = "ERROR"
| stats count() as errors by service, bin(5m)
| sort errors desc
```

### Container Insights (EKS / ECS)

Habilite o Container Insights para coletar métricas de CPU, memória, rede e I/O de disco no nível de pod/task/serviço:

```hcl
resource "aws_eks_addon" "cloudwatch_agent" {
  cluster_name  = aws_eks_cluster.main.name
  addon_name    = "amazon-cloudwatch-observability"
  addon_version = "v1.3.0-eksbuild.1"
  # Requer IRSA com CloudWatchAgentServerPolicy
}
```

### Managed Prometheus + Grafana

Para times que já executam Prometheus, o **Amazon Managed Service for Prometheus (AMP)** oferece um backend totalmente gerenciado compatível com Prometheus. Combine com o **Amazon Managed Grafana (AMG)** para dashboards com SSO via IAM Identity Centre.

```yaml
# Configurar Prometheus remote_write para o AMP
remoteWrite:
  - url: https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-xxx/api/v1/remote_write
    sigv4:
      region: us-east-1
    queue_config:
      max_samples_per_send: 1000
      max_shards: 200
```

---

## X-Ray e OpenTelemetry

O X-Ray fornece rastreamento distribuído — visualize fluxos de requisições entre microsserviços, identifique gargalos e depure problemas de latência.

!!! tip "Prefira OpenTelemetry"
    O **AWS Distro for OpenTelemetry (ADOT)** é o caminho recomendado para nova instrumentação. É compatível com o padrão OTel (vendor-neutral) e pode enviar traces para X-Ray, Jaeger, Zipkin ou qualquer backend OTLP. O X-Ray SDK ainda é suportado, mas cria dependência de vendor.

### Integração com EKS (operador ADOT)

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: OpenTelemetryCollector
metadata:
  name: adot
spec:
  mode: deployment
  config: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
    exporters:
      awsxray:
        region: us-east-1
      awsemf:
        region: us-east-1
    service:
      pipelines:
        traces:
          receivers: [otlp]
          exporters: [awsxray]
        metrics:
          receivers: [otlp]
          exporters: [awsemf]
```

### Regras de amostragem

Controle o volume de traces com regras de amostragem. O padrão é 5% das requisições + 1 requisição/segundo de reservatório. Defina regras personalizadas no console X-Ray ou Terraform:

```hcl
resource "aws_xray_sampling_rule" "api" {
  rule_name      = "api-sampling"
  priority       = 1
  reservoir_size = 10
  fixed_rate     = 0.05
  url_path       = "/api/*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  resource_arn   = "*"
  version        = 1
}
```

---

## CloudTrail

O CloudTrail registra toda chamada de API AWS feita em sua conta — quem fez o quê, quando e de onde. É a base da auditoria de segurança e investigação de incidentes.

### Tipos de eventos

| Tipo | Exemplos | Habilitado por padrão |
|------|---------|----------------------|
| **Management events** | CreateBucket, RunInstances, AssumeRole | Sim (gratuito) |
| **Data events** | S3 GetObject/PutObject, Lambda Invoke | Não (custo: $0,10/100k) |
| **Insights events** | Taxas incomuns de chamada de API, picos de taxa de erros | Não (custo: $0,35/100k) |

```hcl
resource "aws_cloudtrail" "org" {
  name                          = "org-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  is_multi_region_trail         = true
  is_organization_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true  # hash SHA-256 para detecção de adulteração
  kms_key_id                    = aws_kms_key.cloudtrail.arn

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::S3::Object"
      values = ["arn:aws:s3:::${aws_s3_bucket.sensitive.id}/"]
    }
  }

  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_cw.arn
}
```

!!! tip "Athena + CloudTrail"
    Crie uma tabela Athena sobre o prefixo S3 do CloudTrail usando CloudTrail partition projection. Isso fornece investigação baseada em SQL em meses de histórico de API com tempos de consulta abaixo de um segundo a custo quase zero.

---

## AWS Config

O AWS Config registra o estado de configuração dos recursos AWS em cada ponto de mudança, permitindo auditoria de conformidade e detecção de desvios.

### Config Rules

As regras avaliam se os recursos estão em conformidade com uma configuração desejada. A AWS fornece mais de 300 regras gerenciadas; você também pode escrever regras personalizadas usando Lambda ou AWS Config Guard (linguagem de política JSON).

```hcl
resource "aws_config_config_rule" "encrypted_volumes" {
  name        = "encrypted-volumes"
  description = "Verifica se os volumes EBS estão criptografados"

  source {
    owner             = "AWS"
    source_identifier = "ENCRYPTED_VOLUMES"
  }
}

resource "aws_config_config_rule" "s3_public_blocked" {
  name = "s3-bucket-public-access-blocked"

  source {
    owner             = "AWS"
    source_identifier = "S3_BUCKET_LEVEL_PUBLIC_ACCESS_PROHIBITED"
  }
}
```

### Conformance Packs

Os Conformance Packs agrupam regras Config relacionadas + remediação opcional via SSM Automation em um pacote implantável. A AWS fornece packs pré-construídos para CIS, NIST e HIPAA.

```hcl
resource "aws_config_conformance_pack" "cis_l2" {
  name          = "CIS-L2"
  template_body = file("${path.module}/conformance-packs/CIS-AWS-Level2.yaml")

  depends_on = [aws_config_configuration_recorder.main]
}
```

---

## Cost Explorer e Budgets

Visibilidade de custos é uma disciplina operacional. Use o Cost Explorer para análise e Budgets para alertas proativos.

| Ferramenta | Propósito |
|------------|-----------|
| **Cost Explorer** | Visualize, filtre e agrupe custos por serviço, conta, tag, região |
| **Cost Anomaly Detection** | Alertas baseados em ML para picos inesperados de gastos |
| **Budgets** | Alerte quando custo/uso real ou previsto exceder limites |
| **Cost and Usage Report (CUR)** | CSV linha a linha por hora → S3 → Athena/QuickSight para análise profunda |
| **Compute Optimizer** | Recomendações de right-sizing para EC2, ECS, Lambda, EBS |

```hcl
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly-cost"
  budget_type  = "COST"
  limit_amount = "500"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.ops_email]
  }
}
```

!!! tip "Taguear tudo"
    Tags de alocação de custos (`Environment`, `Project`, `Team`, `Service`) são a única forma de detalhar custos por time/produto no Cost Explorer. Imponha tags obrigatórias via regra AWS Config `REQUIRED_TAGS` + SCP que nega criação de recursos sem elas.

---

[← Visão Geral AWS](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
