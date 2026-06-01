---
title: AWS Compute
description: EC2, ECS, EKS, Lambda, Fargate — compute services on AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / compute</span>
    <h1 class="dph-title">AWS Compute</h1>
    <p class="dph-desc">From bare-metal virtual machines to serverless functions, AWS provides compute primitives for every workload shape. Choose the right service based on control requirements, operational overhead and scaling characteristics.</p>
    <div class="dph-badges">
      <span class="tech-badge">EC2</span>
      <span class="tech-badge">ECS</span>
      <span class="tech-badge">EKS</span>
      <span class="tech-badge">Lambda</span>
      <span class="tech-badge">Fargate</span>
      <span class="tech-badge">App Runner</span>
    </div>
  </div>
</div>

---

## EC2 — Elastic Compute Cloud

EC2 provides resizable virtual machines with full OS-level control. It is the foundation of AWS compute and the building block for most other services.

### Instance families

| Family | Purpose | Common types |
|--------|---------|-------------|
| **T** (burstable) | Dev/test, variable-CPU workloads | `t3.micro`, `t3.medium` |
| **M** (general) | Balanced CPU/memory | `m6i.xlarge`, `m7g.2xlarge` |
| **C** (compute) | CPU-intensive: batch, gaming, encoding | `c6i.4xlarge`, `c7g.8xlarge` |
| **R** (memory) | In-memory DBs, large JVM heaps | `r6i.4xlarge`, `r7g.8xlarge` |
| **I** (storage) | High NVMe: Cassandra, Kafka | `i3en.3xlarge`, `i4i.4xlarge` |
| **P / G** | GPU compute / ML inference | `p4d.24xlarge`, `g5.48xlarge` |
| **m7g / c7g / r7g** | Graviton3 ARM — best price/perf | `m7g.xlarge`, `c7g.4xlarge` |

!!! tip "Default to Graviton"
    Graviton3 instances offer **20–40% better price-performance** vs x86 equivalents. Default to the `g` suffix generation (m7g, c7g, r7g) unless your software doesn't support ARM.

### Auto Scaling Groups

ASGs manage fleets of identical instances. Key components: a **Launch Template** (AMI, instance type, security groups, IAM profile, user data) and **scaling policies** (Target Tracking, Step, Scheduled).

```hcl
resource "aws_launch_template" "app" {
  name_prefix            = "app-"
  image_id               = data.aws_ami.al2023.id
  instance_type          = "m7g.xlarge"
  vpc_security_group_ids = [aws_security_group.app.id]

  iam_instance_profile { arn = aws_iam_instance_profile.app.arn }

  user_data = base64encode(<<-EOF
    #!/bin/bash
    dnf install -y amazon-ssm-agent && systemctl enable --now amazon-ssm-agent
  EOF
  )
}

resource "aws_autoscaling_group" "app" {
  name                = "app-asg"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = 2
  max_size            = 20
  desired_capacity    = 2

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 1
      on_demand_percentage_above_base_capacity = 20
      spot_allocation_strategy                 = "price-capacity-optimized"
    }
    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.app.id
        version            = "$Latest"
      }
      override { instance_type = "m7g.xlarge" }
      override { instance_type = "m6g.xlarge" }
      override { instance_type = "m6i.xlarge" }
    }
  }
}
```

!!! note "Spot strategy"
    Use `price-capacity-optimized` allocation strategy and override with 3+ instance types across families. Combine `on_demand_base_capacity = 1` + Spot for the rest to maintain baseline availability even during Spot interruptions.

---

## ECS — Elastic Container Service

ECS is AWS's native container orchestrator. It schedules **Tasks** (running container groups) on **Clusters**, with two launch types: **Fargate** (serverless) and **EC2** (self-managed).

### Core concepts

| Concept | Description |
|---------|-------------|
| **Cluster** | Logical boundary for tasks, services and capacity |
| **Task Definition** | Blueprint: image, vCPU/memory, ports, volumes, IAM role, log config |
| **Task** | A running instance of a Task Definition |
| **Service** | Maintains N running tasks; integrates with ALB, handles rolling deploys |

```hcl
resource "aws_ecs_task_definition" "api" {
  family                   = "api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_exec.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = "${aws_ecr_repository.api.repository_url}:latest"
    essential = true
    portMappings = [{ containerPort = 8080 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/api"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}
```

---

## EKS — Elastic Kubernetes Service

EKS is the AWS managed Kubernetes service. AWS manages the control plane; you choose how to run worker nodes.

### Node options

| Mode | Description | Best for |
|------|-------------|---------|
| **Managed Node Groups** | ASG-backed EC2, patching managed by EKS | Most production clusters |
| **Self-managed nodes** | Custom AMI, OS, ASG | Specific kernel/AMI requirements |
| **Fargate Profiles** | Serverless pods, no nodes | Burstable / batch workloads |
| **Karpenter** | Next-gen provisioner, sub-minute node launch | Large, dynamic clusters |

### Essential add-ons

```hcl
locals {
  eks_addons = {
    vpc-cni            = "v1.18.0-eksbuild.1"
    coredns            = "v1.11.1-eksbuild.6"
    kube-proxy         = "v1.29.0-eksbuild.1"
    aws-ebs-csi-driver = "v1.28.0-eksbuild.1"
  }
}

resource "aws_eks_addon" "main" {
  for_each                    = local.eks_addons
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = each.key
  addon_version               = each.value
  resolve_conflicts_on_update = "OVERWRITE"
}
```

### IRSA — IAM Roles for Service Accounts

IRSA lets pods assume IAM roles without static credentials, using the EKS OIDC provider as a trust anchor.

```hcl
data "aws_iam_policy_document" "irsa_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub"
      values   = ["system:serviceaccount:${var.namespace}:${var.sa_name}"]
    }
  }
}

resource "aws_iam_role" "workload" {
  name               = "${var.name}-irsa"
  assume_role_policy = data.aws_iam_policy_document.irsa_assume.json
}
```

!!! tip "Community EKS module"
    Use [`terraform-aws-modules/eks/aws`](https://registry.terraform.io/modules/terraform-aws-modules/eks/aws) — it wires up the cluster, managed node groups, OIDC provider and IRSA with sensible defaults. Pin to a specific version and review the changelog between upgrades.

---

## Lambda

Lambda runs code in response to events without managing any infrastructure. Scales from zero to tens of thousands of concurrent executions automatically.

### Runtimes & limits

| Property | Value |
|----------|-------|
| Runtimes | Node.js 20, Python 3.12, Java 21, Go, Ruby 3.2, .NET 8, Container image, Custom |
| Memory | 128 MB – 10 GB (CPU scales proportionally) |
| Timeout | up to 15 minutes |
| Ephemeral storage `/tmp` | 512 MB – 10 GB |
| Deployment package | 50 MB zipped / 250 MB unzipped / 10 GB container image |

### Common event sources

| Trigger | Invocation | Use case |
|---------|-----------|---------|
| API Gateway / Function URL | Sync | HTTP APIs |
| S3 | Async | File processing on upload |
| SQS | Polling | Message queue workers |
| EventBridge | Async | Scheduled jobs, event pipelines |
| DynamoDB Streams | Polling | React to DB changes |
| Kinesis | Polling | Real-time stream processing |

```hcl
resource "aws_lambda_function" "processor" {
  function_name = "event-processor"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.app.repository_url}:latest"
  memory_size   = 1024
  timeout       = 300

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.events.name
      REGION     = var.region
    }
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }
}

resource "aws_lambda_event_source_mapping" "sqs" {
  event_source_arn                   = aws_sqs_queue.events.arn
  function_name                      = aws_lambda_function.processor.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 30
  function_response_types            = ["ReportBatchItemFailures"]
}
```

!!! note "VPC Lambda"
    Lambda in a VPC is no longer slow — AWS pre-warms ENIs since 2020. You still need sufficient IP space in your subnets (avoid `/28`; prefer `/24` or larger). Use VPC endpoints for S3, DynamoDB and Secrets Manager to avoid traffic routing through NAT.

---

## Fargate

Fargate is the serverless compute engine for containers, available in both **ECS** and **EKS**. No EC2 nodes to patch, no AMIs to manage.

### ECS Fargate sizing

| vCPU | Available memory |
|------|-----------------|
| 0.25 | 0.5 – 2 GB |
| 0.5  | 1 – 4 GB |
| 1    | 2 – 8 GB |
| 2    | 4 – 16 GB |
| 4    | 8 – 30 GB |
| 8    | 16 – 60 GB |
| 16   | 32 – 120 GB |

### ECS vs EKS Fargate

| | ECS Fargate | EKS Fargate |
|--|-------------|-------------|
| **Operational overhead** | Low | Medium (K8s API) |
| **Tooling** | AWS-native (awscli, CDK) | Standard Kubernetes toolchain |
| **Networking** | ENI per task (awsvpc mode) | ENI per pod |
| **Persistent storage** | Ephemeral + EFS volumes | EFS only |
| **Best for** | Simple services, microservices | Teams already on Kubernetes |

!!! tip "Fargate Spot"
    Enable **Fargate Spot** as a second capacity provider in ECS for up to 70% savings on fault-tolerant workloads. Use `base = 1` for the FARGATE provider and weight the rest toward FARGATE_SPOT.

---

[← AWS Overview](index.md){ .md-button }
[Storage →](storage.md){ .md-button .md-button--primary }
