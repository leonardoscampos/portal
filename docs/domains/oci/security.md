---
title: OCI Segurança & IAM
description: OCI IAM, Vault, Security Zones, Cloud Guard, Bastion, Certificados — segurança na Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / security</span>
    <h1 class="dph-title">OCI Segurança &amp; IAM</h1>
    <p class="dph-desc">O OCI IAM usa compartimentos para isolar recursos e políticas para conceder acesso. Dynamic Groups habilitam Instance Principals — VMs de Computação e pods OKE se autenticam nos serviços OCI sem credenciais armazenadas. O Vault protege chaves e segredos. O Cloud Guard monitora continuamente ameaças.</p>
    <div class="dph-badges">
      <span class="tech-badge">OCI IAM</span>
      <span class="tech-badge">Compartments</span>
      <span class="tech-badge">Dynamic Groups</span>
      <span class="tech-badge">Vault</span>
      <span class="tech-badge">Security Zones</span>
      <span class="tech-badge">Cloud Guard</span>
      <span class="tech-badge">Bastion</span>
    </div>
  </div>
</div>

---

## OCI IAM

O OCI IAM é o sistema de gerenciamento de identidade e acesso da OCI. Ao contrário do AWS IAM ou GCP IAM, o OCI IAM usa **compartimentos** como mecanismo primário de isolamento de recursos — pense nos compartimentos como contêineres de recursos que espelham a estrutura da sua organização.

### Compartimentos

```
Compartimento Raiz (Tenancy)
  ├── Networking
  │     └── VCNs, DRG, zonas DNS
  ├── Production
  │     ├── Production-Apps
  │     └── Production-Data
  ├── Staging
  └── Shared-Services
        └── Identity, Vault, Bastion
```

```hcl
resource "oci_identity_compartment" "production" {
  compartment_id = var.tenancy_ocid
  name           = "production"
  description    = "Production workloads"
}

resource "oci_identity_compartment" "prod_apps" {
  compartment_id = oci_identity_compartment.production.id
  name           = "prod-apps"
  description    = "Production application resources (OKE, instances)"
}
```

### Políticas IAM

As políticas são escritas em uma linguagem de política legível por humanos, vinculada a um compartimento:

```
Allow <subject> to <verb> <resource-type> in <location> [where <conditions>]
```

| Verbo | Operações permitidas |
|-------|----------------------|
| **inspect** | Listar recursos (sem detalhes) |
| **read** | Inspect + obter detalhes do recurso |
| **use** | Read + realizar operações (iniciar/parar VM, etc.) |
| **manage** | CRUD completo |

```hcl
resource "oci_identity_policy" "oke_node_policy" {
  compartment_id = var.tenancy_ocid  # tenancy-level for cross-compartment access
  name           = "oke-node-policy"
  description    = "Allow OKE nodes to manage themselves and access required services"

  statements = [
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to read secret-family in compartment production",
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to manage instance-family in compartment production",
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to use subnets in compartment networking",
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to read buckets in compartment production",
    "Allow dynamic-group '${oci_identity_dynamic_group.oke_nodes.name}' to manage objects in compartment production",
  ]
}
```

---

## Dynamic Groups

Os Dynamic Groups permitem que instâncias de computação, pods OKE e outros recursos OCI se autentiquem nos serviços OCI como um **principal** — sem chaves de API ou credenciais armazenadas. A associação é definida por uma regra de correspondência.

```hcl
# Dynamic group for OKE node pool instances
resource "oci_identity_dynamic_group" "oke_nodes" {
  compartment_id = var.tenancy_ocid
  name           = "${var.project}-oke-nodes"
  description    = "OKE cluster node instances"
  matching_rule  = "instance.compartment.id = '${oci_identity_compartment.prod_apps.id}'"
}

# Dynamic group for Oracle Functions
resource "oci_identity_dynamic_group" "functions" {
  compartment_id = var.tenancy_ocid
  name           = "${var.project}-functions"
  description    = "Oracle Functions service"
  matching_rule  = "ALL {resource.type = 'fnfunc', resource.compartment.id = '${oci_identity_compartment.prod_apps.id}'}"
}

# Dynamic group for OKE Workload Identity (specific pods by namespace)
resource "oci_identity_dynamic_group" "oke_workload" {
  compartment_id = var.tenancy_ocid
  name           = "${var.project}-oke-workload-identity"
  description    = "OKE pods using Workload Identity"
  matching_rule  = "ALL {resource.type = 'workloadidentities', resource.compartment.id = '${oci_identity_compartment.prod_apps.id}'}"
}
```

---

## OCI Vault

O OCI Vault gerencia chaves de criptografia mestras e segredos. As chaves são armazenadas em hardware respaldado por HSM (FIPS 140-2 Level 3). O Vault integra-se com Block Volumes, Object Storage, Boot Volumes e o etcd do OKE para CMEK.

### Tipos de Vault

| Tipo | Armazenamento de chaves | Caso de uso |
|------|------------------------|-------------|
| **Virtual Private Vault** | Partição HSM dedicada | Produção de alta segurança |
| **Default Virtual Vault** | HSM compartilhado | Cargas de trabalho padrão (menor custo) |

```hcl
resource "oci_kms_vault" "main" {
  compartment_id = var.compartment_id
  display_name   = "${var.project}-vault"
  vault_type     = "DEFAULT"
}

resource "oci_kms_key" "master" {
  compartment_id      = var.compartment_id
  display_name        = "${var.project}-master-key"
  management_endpoint = oci_kms_vault.main.management_endpoint

  key_shape {
    algorithm = "AES"
    length    = 32   # AES-256
  }
}
```

### Segredos

```hcl
resource "oci_vault_secret" "db_password" {
  compartment_id = var.compartment_id
  vault_id       = oci_kms_vault.main.id
  key_id         = oci_kms_key.master.id
  secret_name    = "db-password"

  secret_content {
    content_type = "BASE64"
    content      = base64encode(var.db_password)
  }

  secret_rules {
    rule_type                  = "SECRET_EXPIRY_RULE"
    is_secret_content_retrieved_on_expiry = false
    time_of_absolute_expiry    = "2025-12-31T00:00:00Z"
  }
}
```

### Recuperar um segredo em pods OKE

Use Instance Principals (Dynamic Group) + o OCI SDK — sem necessidade de injeção de segredos:

```python
import oci

config = oci.config.from_file()   # or use InstancePrincipalsSecurityTokenSigner
signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
secrets_client = oci.secrets.SecretsClient({}, signer=signer)

secret_bundle = secrets_client.get_secret_bundle(
    secret_id="ocid1.vaultsecret.oc1.iad...."
).data

import base64
password = base64.b64decode(secret_bundle.secret_bundle_content.content).decode()
```

---

## Security Zones

As Security Zones aplicam um conjunto de **políticas de zona de segurança** em um compartimento — elas impedem operações que violem as políticas. A Oracle fornece uma receita de **Segurança Máxima** que bloqueia IPs públicos, armazenamento não criptografado e buckets públicos.

```hcl
resource "oci_cloud_guard_security_zone" "production" {
  compartment_id        = oci_identity_compartment.production.id
  display_name          = "production-security-zone"
  security_zone_recipe_id = data.oci_cloud_guard_security_recipes.maximum_security.security_recipe_collection[0].items[0].id
  description           = "Enforces maximum security policies on production compartment"
}
```

!!! warning "Restrições da Security Zone"
    Habilitar uma Security Zone bloqueará a criação de recursos que violem suas políticas — incluindo VNICs com IP público e Block Volumes não criptografados. Teste todo o código IaC em um compartimento sem zona primeiro, depois migre para a zona quando estiver em conformidade.

---

## Cloud Guard

O Cloud Guard monitora continuamente recursos e atividades OCI em busca de ameaças de segurança e configurações incorretas. Ele mapeia as descobertas para detectores (regras de segurança) e as apresenta como **problemas** com uma pontuação de risco.

### Tipos de detectores

| Detector | O que monitora |
|----------|----------------|
| **Configuração** | Configurações incorretas: buckets públicos, security lists sem restrição, sem MFA |
| **Atividade** | Chamadas de API suspeitas: geografia incomum, falhas excessivas, escalonamento de privilégio |
| **Inteligência de Ameaças** | IPs/domínios maliciosos conhecidos em fluxos de rede ou logs de auditoria |

```hcl
resource "oci_cloud_guard_cloud_guard_configuration" "main" {
  compartment_id   = var.tenancy_ocid
  reporting_region = var.region
  status           = "ENABLED"
  self_manage_resources_enabled = false
}

resource "oci_cloud_guard_target" "root" {
  compartment_id            = var.tenancy_ocid
  display_name              = "Root Compartment Target"
  target_resource_id        = var.tenancy_ocid
  target_resource_type      = "COMPARTMENT"
  state                     = "ACTIVE"
}
```

---

## Serviço Bastion

O OCI Bastion fornece acesso SSH ou RDP seguro e temporário a instâncias privadas — sem VM de jump box para gerenciar, sem IP público no destino.

```hcl
resource "oci_bastion_bastion" "main" {
  bastion_type     = "STANDARD"
  compartment_id   = var.compartment_id
  target_subnet_id = oci_core_subnet.private_app.id
  name             = "${var.project}-bastion"

  client_cidr_block_allow_list = ["203.0.113.0/24"]  # restrict to corporate CIDR
  max_session_ttl_in_seconds   = 3600  # 1-hour maximum
}

resource "oci_bastion_session" "ssh" {
  bastion_id = oci_bastion_bastion.main.id

  key_details {
    public_key_content = file("~/.ssh/id_rsa.pub")
  }

  target_resource_details {
    session_type                      = "MANAGED_SSH"
    target_resource_id                = oci_core_instance.app.id
    target_resource_operating_system_user_name = "opc"
    target_resource_port              = 22
  }

  session_ttl_in_seconds = 3600
}
```

---

[← Visão Geral OCI](index.md){ .md-button }
[Observabilidade →](observability.md){ .md-button .md-button--primary }
