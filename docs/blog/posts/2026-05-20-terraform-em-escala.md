---
date: 2026-05-20
authors:
  - leonardoscampos
categories:
  - IaC
tags:
  - terraform
  - aws
  - multi-cloud
  - boas-práticas
---

# Terraform em Escala: Lições de Produção

Depois de gerenciar infraestrutura Terraform em múltiplos times e provedores cloud, aprendi que a maioria dos problemas não vem do código HCL — vem da **organização**. Neste post, compartilho os padrões que funcionaram em produção.

<!-- more -->

## O problema de "tudo num repositório"

A maioria dos times começa com um único repositório e uma única pasta `terraform/`. Isso funciona bem até o momento em que:

- O `terraform plan` demora 10+ minutos por conta do state monolítico
- Um erro numa alteração derruba toda a infraestrutura
- Times diferentes precisam de ciclos de release independentes

A solução é **separar os workspaces por camada e por time**.

## Estrutura de repositórios recomendada

```
infra-core/          # Rede, IAM, DNS — time de plataforma
infra-data/          # RDS, S3, Glue — time de dados
infra-app/           # EKS, ALB, ECR — time de produto
```

Cada repositório tem seu próprio remote state, suas próprias variáveis e seu próprio ciclo de CI/CD. Eles se comunicam via **data sources**:

```hcl
# infra-app lendo outputs do infra-core
data "terraform_remote_state" "core" {
  backend = "s3"
  config = {
    bucket = "my-tfstate"
    key    = "core/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_eks_cluster" "main" {
  vpc_config {
    subnet_ids = data.terraform_remote_state.core.outputs.private_subnet_ids
  }
}
```

## Remote State: S3 + DynamoDB com versionamento

Nunca use remote state sem lock. A configuração mínima segura:

```hcl
terraform {
  backend "s3" {
    bucket         = "my-company-tfstate"
    key            = "app/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
```

!!! tip "Versione o state bucket"
    Ative versionamento no S3 e políticas de retenção. Já precisei restaurar um state corrompido — sem versioning, seria catástrofe.

## Módulos: não recrie o que já existe

Antes de escrever um módulo do zero, verifique o [Terraform Registry](https://registry.terraform.io). Os módulos da comunidade (`terraform-aws-modules`) são amplamente testados e mantidos.

Quando criar módulos próprios, siga estas regras:

| Regra | Motivo |
|-------|--------|
| Um módulo = uma responsabilidade | Facilita testes e reutilização |
| Exponha apenas o necessário como output | Evita dependências implícitas |
| Versione com tags Git | Garante reprodutibilidade |
| Inclua `README.md` com exemplos | Documentação é parte do produto |

## CI/CD: Plan automatizado, Apply manual em produção

O fluxo que funciona na prática:

1. **PR aberto** → `terraform plan` automático com output no PR
2. **PR aprovado** → merge na `main`
3. **Deploy em staging** → `terraform apply` automático
4. **Deploy em produção** → `terraform apply` com aprovação manual no pipeline

```yaml
# GitHub Actions — plan no PR
- name: Terraform Plan
  run: |
    terraform init
    terraform plan -out=tfplan -no-color 2>&1 | tee plan.txt

- name: Comentar no PR
  uses: actions/github-script@v7
  with:
    script: |
      const plan = require('fs').readFileSync('plan.txt', 'utf8')
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        body: `\`\`\`hcl\n${plan}\n\`\`\``
      })
```

## Conclusão

Terraform em escala é um problema de engenharia de software, não de sintaxe HCL. Invista em:

- **Estrutura de repositórios** clara desde o início
- **Remote state** seguro com lock e versionamento
- **Módulos versionados** em vez de copy-paste
- **CI/CD** que automatiza o plan mas exige aprovação para o apply em produção

Esses padrões economizaram horas de incidentes e tornaram onboarding de novos membros muito mais rápido.
