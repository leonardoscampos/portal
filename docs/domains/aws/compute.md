---
title: AWS Computação
description: EC2, ECS, EKS, Lambda, Fargate — serviços de computação na AWS.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// aws / compute</span>
    <h1 class="dph-title">AWS Computação</h1>
    <p class="dph-desc">De máquinas virtuais bare-metal a funções serverless, a AWS oferece primitivos de computação para cada tipo de carga de trabalho. Escolha o serviço certo com base nos requisitos de controle, sobrecarga operacional e características de escalabilidade.</p>
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

O EC2 fornece máquinas virtuais redimensionáveis com controle total em nível de sistema operacional. É a base da computação na AWS e o bloco de construção para a maioria dos outros serviços.

### Famílias de instâncias

| Família | Propósito | Tipos comuns |
|---------|-----------|--------------|
| **T** (burstável) | Dev/test, cargas com CPU variável | `t3.micro`, `t3.medium` |
| **M** (geral) | CPU/memória balanceados | `m6i.xlarge`, `m7g.2xlarge` |
| **C** (computação) | CPU intensivo: batch, gaming, encoding | `c6i.4xlarge`, `c7g.8xlarge` |
| **R** (memória) | BDs em memória, heaps JVM grandes | `r6i.4xlarge`, `r7g.8xlarge` |
| **I** (armazenamento) | NVMe alto: Cassandra, Kafka | `i3en.3xlarge`, `i4i.4xlarge` |
| **P / G** | Computação GPU / inferência ML | `p4d.24xlarge`, `g5.48xlarge` |
| **m7g / c7g / r7g** | Graviton3 ARM — melhor custo/desempenho | `m7g.xlarge`, `c7g.4xlarge` |

!!! tip "Prefira Graviton"
    As instâncias Graviton3 oferecem **20–40% melhor custo-desempenho** em comparação com equivalentes x86. Use por padrão a geração com sufixo `g` (m7g, c7g, r7g), a menos que seu software não suporte ARM.

### Auto Scaling Groups

Os ASGs gerenciam frotas de instâncias idênticas. Componentes principais: um **Launch Template** (AMI, tipo de instância, grupos de segurança, perfil IAM, user data) e **políticas de escalabilidade** (Target Tracking, Step, Scheduled).

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

!!! note "Estratégia Spot"
    Use a estratégia de alocação `price-capacity-optimized` e substitua com 3+ tipos de instância de diferentes famílias. Combine `on_demand_base_capacity = 1` + Spot para o restante, mantendo disponibilidade de base mesmo durante interrupções Spot.

---

## ECS — Elastic Container Service

O ECS é o orquestrador de contêineres nativo da AWS. Ele agenda **Tasks** (grupos de contêineres em execução) em **Clusters**, com dois tipos de lançamento: **Fargate** (serverless) e **EC2** (gerenciado pelo usuário).

### Conceitos principais

| Conceito | Descrição |
|----------|-----------|
| **Cluster** | Limite lógico para tasks, serviços e capacidade |
| **Task Definition** | Blueprint: imagem, vCPU/memória, portas, volumes, IAM role, configuração de log |
| **Task** | Uma instância em execução de uma Task Definition |
| **Service** | Mantém N tasks em execução; integra-se com ALB, gerencia deploys contínuos |

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

O EKS é o serviço Kubernetes gerenciado da AWS. A AWS gerencia o plano de controle; você escolhe como executar os worker nodes.

### Opções de nodes

| Modo | Descrição | Melhor para |
|------|-----------|-------------|
| **Managed Node Groups** | EC2 com ASG, patching gerenciado pelo EKS | Maioria dos clusters em produção |
| **Nodes self-managed** | AMI, SO e ASG personalizados | Requisitos específicos de kernel/AMI |
| **Fargate Profiles** | Pods serverless, sem nodes | Cargas burstáveis / batch |
| **Karpenter** | Provisionador de nova geração, lançamento de node em menos de 1 minuto | Clusters grandes e dinâmicos |

### Add-ons essenciais

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

O IRSA permite que pods assumam roles IAM sem credenciais estáticas, utilizando o provedor OIDC do EKS como âncora de confiança.

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

!!! tip "Módulo EKS da comunidade"
    Use [`terraform-aws-modules/eks/aws`](https://registry.terraform.io/modules/terraform-aws-modules/eks/aws) — ele configura o cluster, managed node groups, provedor OIDC e IRSA com padrões sensatos. Fixe em uma versão específica e revise o changelog entre atualizações.

---

## Lambda

O Lambda executa código em resposta a eventos sem gerenciar nenhuma infraestrutura. Escala de zero a dezenas de milhares de execuções simultâneas automaticamente.

### Runtimes e limites

| Propriedade | Valor |
|-------------|-------|
| Runtimes | Node.js 20, Python 3.12, Java 21, Go, Ruby 3.2, .NET 8, Imagem de contêiner, Personalizado |
| Memória | 128 MB – 10 GB (CPU escala proporcionalmente) |
| Timeout | até 15 minutos |
| Armazenamento efêmero `/tmp` | 512 MB – 10 GB |
| Pacote de implantação | 50 MB comprimido / 250 MB descomprimido / 10 GB imagem de contêiner |

### Fontes de eventos comuns

| Trigger | Invocação | Caso de uso |
|---------|-----------|-------------|
| API Gateway / Function URL | Síncrono | APIs HTTP |
| S3 | Assíncrono | Processamento de arquivos no upload |
| SQS | Polling | Workers de fila de mensagens |
| EventBridge | Assíncrono | Jobs agendados, pipelines de eventos |
| DynamoDB Streams | Polling | Reagir a alterações no BD |
| Kinesis | Polling | Processamento de stream em tempo real |

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

!!! note "Lambda em VPC"
    O Lambda em VPC não é mais lento — a AWS pré-aquece ENIs desde 2020. Você ainda precisa de espaço suficiente de IPs nas suas sub-redes (evite `/28`; prefira `/24` ou maior). Use VPC endpoints para S3, DynamoDB e Secrets Manager para evitar tráfego roteado pelo NAT.

---

## Fargate

O Fargate é o motor de computação serverless para contêineres, disponível tanto no **ECS** quanto no **EKS**. Sem nodes EC2 para corrigir, sem AMIs para gerenciar.

### Dimensionamento do ECS Fargate

| vCPU | Memória disponível |
|------|--------------------|
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
| **Sobrecarga operacional** | Baixa | Média (API K8s) |
| **Ferramentas** | Nativo AWS (awscli, CDK) | Toolchain padrão Kubernetes |
| **Rede** | ENI por task (modo awsvpc) | ENI por pod |
| **Armazenamento persistente** | Efêmero + volumes EFS | Somente EFS |
| **Melhor para** | Serviços simples, microsserviços | Times já usando Kubernetes |

!!! tip "Fargate Spot"
    Habilite o **Fargate Spot** como segundo provedor de capacidade no ECS para até 70% de economia em cargas tolerantes a falhas. Use `base = 1` para o provedor FARGATE e distribua o restante para FARGATE_SPOT.

---

[← Visão Geral AWS](index.md){ .md-button }
[Armazenamento →](storage.md){ .md-button .md-button--primary }
