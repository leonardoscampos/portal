---
title: OCI Security & IAM
description: OCI IAM, Vault, Security Zones, Cloud Guard, Bastion, Certificates — security on Oracle Cloud.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// oci / security</span>
    <h1 class="dph-title">OCI Security &amp; IAM</h1>
    <p class="dph-desc">OCI IAM uses compartments to isolate resources and policies to grant access. Dynamic Groups enable Instance Principals — Compute VMs and OKE pods authenticate to OCI services without stored credentials. Vault protects keys and secrets. Cloud Guard continuously monitors for threats.</p>
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

OCI IAM is the identity and access management system for OCI. Unlike AWS IAM or GCP IAM, OCI IAM uses **compartments** as the primary resource isolation mechanism — think of compartments as resource containers that mirror your org structure.

### Compartments

```
Root Compartment (Tenancy)
  ├── Networking
  │     └── VCNs, DRG, DNS zones
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

### IAM Policies

Policies are written in a human-readable policy language attached to a compartment:

```
Allow <subject> to <verb> <resource-type> in <location> [where <conditions>]
```

| Verb | Operations allowed |
|------|-------------------|
| **inspect** | List resources (no details) |
| **read** | Inspect + get resource details |
| **use** | Read + perform operations (start/stop VM, etc.) |
| **manage** | Full CRUD |

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

Dynamic Groups allow compute instances, OKE pods and other OCI resources to authenticate to OCI services as a **principal** — no API keys or stored credentials needed. Membership is defined by a matching rule.

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

OCI Vault manages master encryption keys and secrets. Keys are stored in HSM-backed hardware (FIPS 140-2 Level 3). Vault integrates with Block Volumes, Object Storage, Boot Volumes and OKE etcd for CMEK.

### Vault types

| Type | Key storage | Use case |
|------|------------|---------|
| **Virtual Private Vault** | Dedicated HSM partition | High-security production |
| **Default Virtual Vault** | Shared HSM | Standard workloads (lower cost) |

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

### Secrets

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

### Retrieve a secret in OKE pods

Use Instance Principals (Dynamic Group) + the OCI SDK — no secret injection needed:

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

Security Zones enforce a set of **security zone policies** on a compartment — they prevent operations that violate the policies. Oracle provides a **Maximum Security** recipe that blocks public IPs, unencrypted storage and public buckets.

```hcl
resource "oci_cloud_guard_security_zone" "production" {
  compartment_id        = oci_identity_compartment.production.id
  display_name          = "production-security-zone"
  security_zone_recipe_id = data.oci_cloud_guard_security_recipes.maximum_security.security_recipe_collection[0].items[0].id
  description           = "Enforces maximum security policies on production compartment"
}
```

!!! warning "Security Zone restrictions"
    Enabling a Security Zone will block creation of resources that violate its policies — including public-IP VNICs and unencrypted Block Volumes. Test all IaC code against a non-zone compartment first, then migrate to the zone once compliant.

---

## Cloud Guard

Cloud Guard continuously monitors OCI resources and activities for security threats and misconfigurations. It maps findings to detectors (security rules) and surfaces them as **problems** with a risk score.

### Detector types

| Detector | What it monitors |
|---------|----------------|
| **Configuration** | Misconfigurations: public buckets, unrestricted security lists, no MFA |
| **Activity** | Suspicious API calls: unusual geography, excessive failures, privilege escalation |
| **Threat Intelligence** | Known malicious IPs/domains in network flows or audit logs |

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

## Bastion Service

OCI Bastion provides secure, temporary SSH or RDP access to private instances — no jump box VM to manage, no public IP on the target.

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

[← OCI Overview](index.md){ .md-button }
[Observability →](observability.md){ .md-button .md-button--primary }
