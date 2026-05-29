---
title: AWS Observability
description: CloudWatch, X-Ray, CloudTrail, AWS Config, Cost Explorer — observability on AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / observability</span>
    <h1 class="dph-title">AWS Observability</h1>
    <p class="dph-desc">Metrics, logs, traces, audit trails and compliance drift — the full observability stack for AWS workloads. Built on CloudWatch as the core data plane, enriched with X-Ray tracing, CloudTrail auditing and AWS Config for configuration history.</p>
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

CloudWatch is the native AWS observability platform covering **metrics**, **logs**, **alarms**, **dashboards** and **synthetic canaries**. Almost every AWS service publishes metrics to CloudWatch automatically.

### Metrics fundamentals

| Concept | Description |
|---------|-------------|
| **Namespace** | Logical grouping: `AWS/EC2`, `AWS/ECS`, `AWS/ApplicationELB`, `CWAgent` |
| **Dimension** | Key-value filter: `InstanceId=i-0abc123`, `ClusterName=prod` |
| **Metric** | The measurable value: `CPUUtilization`, `HTTPCode_Target_5XX_Count` |
| **Statistic** | Aggregation: `Average`, `Sum`, `Maximum`, `p99` |
| **Period** | Aggregation window: 1s / 10s / 30s / 60s / 5m / 1hr |

### Alarms

Alarms transition between `OK`, `ALARM` and `INSUFFICIENT_DATA`. Actions include SNS notifications, Auto Scaling policy triggers and EC2 instance recovery.

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

### Composite alarms

Composite alarms combine multiple alarms with AND/OR logic, reducing alert noise. Use them to create a single "service health" alarm that fires only when multiple signals are degraded simultaneously.

```hcl
resource "aws_cloudwatch_composite_alarm" "service_degraded" {
  alarm_name = "${var.project}-service-degraded"

  alarm_rule = "ALARM(${aws_cloudwatch_metric_alarm.api_5xx.alarm_name}) AND ALARM(${aws_cloudwatch_metric_alarm.api_latency_p99.alarm_name})"

  alarm_actions = [aws_sns_topic.pagerduty.arn]
}
```

### Logs Insights

CloudWatch Logs Insights is a query language for searching and analysing log data across log groups. Key operators:

```sql
-- Top 10 slowest API endpoints in the last hour
fields @timestamp, path, duration_ms
| filter status >= 200
| stats avg(duration_ms) as avg_ms, count() as requests by path
| sort avg_ms desc
| limit 10
```

```sql
-- Error rate per service
fields @timestamp, service, level
| filter level = "ERROR"
| stats count() as errors by service, bin(5m)
| sort errors desc
```

### Container Insights (EKS / ECS)

Enable Container Insights to collect CPU, memory, network and disk I/O metrics at the pod/task/service level:

```hcl
resource "aws_eks_addon" "cloudwatch_agent" {
  cluster_name  = aws_eks_cluster.main.name
  addon_name    = "amazon-cloudwatch-observability"
  addon_version = "v1.3.0-eksbuild.1"
  # Requires IRSA with CloudWatchAgentServerPolicy
}
```

### Managed Prometheus + Grafana

For teams already running Prometheus, **Amazon Managed Service for Prometheus (AMP)** provides a fully managed Prometheus-compatible backend. Pair with **Amazon Managed Grafana (AMG)** for dashboards with SSO via IAM Identity Centre.

```yaml
# Configure Prometheus remote_write to AMP
remoteWrite:
  - url: https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-xxx/api/v1/remote_write
    sigv4:
      region: us-east-1
    queue_config:
      max_samples_per_send: 1000
      max_shards: 200
```

---

## X-Ray & OpenTelemetry

X-Ray provides distributed tracing — visualise request flows across microservices, identify bottlenecks and debug latency issues.

!!! tip "Prefer OpenTelemetry"
    The **AWS Distro for OpenTelemetry (ADOT)** is the recommended path for new instrumentation. It is OTel-standard (vendor-neutral) and can send traces to X-Ray, Jaeger, Zipkin or any OTLP-compatible backend. The X-Ray SDK is still supported but creates vendor lock-in.

### EKS integration (ADOT operator)

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

### Sampling rules

Control trace volume with sampling rules. The default is 5% of requests + 1 request/second reservoir. Define custom rules in X-Ray console or Terraform:

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

CloudTrail records every AWS API call made in your account — who did what, when, from where. It is the foundation of security auditing and incident investigation.

### Event types

| Type | Examples | Default enabled |
|------|---------|----------------|
| **Management events** | CreateBucket, RunInstances, AssumeRole | Yes (free) |
| **Data events** | S3 GetObject/PutObject, Lambda Invoke | No (cost: $0.10/100k) |
| **Insights events** | Unusual API call rates, error rate spikes | No (cost: $0.35/100k) |

```hcl
resource "aws_cloudtrail" "org" {
  name                          = "org-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  is_multi_region_trail         = true
  is_organization_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true  # SHA-256 hash for tamper detection
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
    Create an Athena table over the CloudTrail S3 prefix using the CloudTrail partition projection. This gives you SQL-based investigation across months of API history with sub-second query times at near-zero cost.

---

## AWS Config

AWS Config records the configuration state of AWS resources at every change point, enabling compliance auditing and drift detection.

### Config Rules

Rules evaluate whether resources comply with a desired configuration. AWS provides 300+ managed rules; you can also write custom rules using Lambda or AWS Config Guard (JSON policy language).

```hcl
resource "aws_config_config_rule" "encrypted_volumes" {
  name        = "encrypted-volumes"
  description = "Checks if EBS volumes are encrypted"

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

Conformance packs bundle related Config rules + optional SSM Automation remediation into a deployable package. AWS provides pre-built packs for CIS, NIST and HIPAA.

```hcl
resource "aws_config_conformance_pack" "cis_l2" {
  name          = "CIS-L2"
  template_body = file("${path.module}/conformance-packs/CIS-AWS-Level2.yaml")

  depends_on = [aws_config_configuration_recorder.main]
}
```

---

## Cost Explorer & Budgets

Cost visibility is an operational discipline. Use Cost Explorer for analysis and Budgets for proactive alerts.

| Tool | Purpose |
|------|---------|
| **Cost Explorer** | Visualise, filter and group costs by service, account, tag, region |
| **Cost Anomaly Detection** | ML-based alerts for unexpected spend spikes |
| **Budgets** | Alert when actual/forecast cost or usage exceeds thresholds |
| **Cost and Usage Report (CUR)** | Hourly line-item CSV → S3 → Athena/QuickSight for deep analysis |
| **Compute Optimizer** | Right-sizing recommendations for EC2, ECS, Lambda, EBS |

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

!!! tip "Tag everything"
    Cost allocation tags (`Environment`, `Project`, `Team`, `Service`) are the only way to break down costs per team/product in Cost Explorer. Enforce mandatory tags via AWS Config rule `REQUIRED_TAGS` + SCP that denies resource creation without them.

---

[← AWS Overview](index.md){ .md-button }
[IaC & DevOps →](iac.md){ .md-button .md-button--primary }
