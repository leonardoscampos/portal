---
title: Azure Security & IAM
description: Entra ID, RBAC, Key Vault, Defender for Cloud, Azure Policy, PIM — security on Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / security</span>
    <h1 class="dph-title">Azure Security &amp; IAM</h1>
    <p class="dph-desc">Entra ID is the identity backbone for Azure — every API call is authenticated against it. Pair RBAC with Workload Identity for zero-secret AKS pods, centralise secrets in Key Vault, enforce configuration with Azure Policy and gain cloud posture visibility with Defender for Cloud.</p>
    <div class="dph-badges">
      <span class="tech-badge">Entra ID</span>
      <span class="tech-badge">RBAC</span>
      <span class="tech-badge">Key Vault</span>
      <span class="tech-badge">Defender for Cloud</span>
      <span class="tech-badge">Azure Policy</span>
      <span class="tech-badge">PIM</span>
    </div>
  </div>
</div>

---

## Microsoft Entra ID (formerly Azure AD)

Entra ID is Azure's identity provider — it handles authentication (who you are) for all Azure services. Authorization is handled by Azure RBAC (what you can do).

### Key identity primitives

| Primitive | Description |
|-----------|-------------|
| **User** | Human identities, synced from on-prem AD or cloud-only |
| **Service Principal** | App identity — used by automation, Terraform, CI pipelines |
| **Managed Identity** | System-assigned or user-assigned identity for Azure resources (no credential management) |
| **Workload Identity** | OIDC federation for Kubernetes pods — replaces aad-pod-identity |
| **Groups** | Assign RBAC roles to groups, not individual identities |
| **App Registration** | OAuth 2.0 / OIDC client registration |

### Authentication flows for automation

```
Terraform / CI pipeline
  → Service Principal (client ID + secret or federated credential)
  → Entra ID token
  → Azure Resource Manager API

AKS pod
  → Workload Identity (OIDC projected volume token)
  → Entra ID validates token against AKS OIDC issuer
  → Returns access token for Key Vault / Storage / etc.
```

---

## Azure RBAC

Azure RBAC controls who can perform what actions on which resources. Assignments are scoped: Management Group → Subscription → Resource Group → Resource.

### Built-in roles

| Role | Scope | Use case |
|------|-------|---------|
| **Owner** | Full control + RBAC management | Avoid; prefer Contributor |
| **Contributor** | Full resource control, no RBAC | App team lead |
| **Reader** | Read-only | Auditors, read-only CI steps |
| **AKS Cluster Admin** | Full kubectl access | Break-glass only |
| **AKS Azure RBAC Admin** | RBAC management in cluster | Cluster operators |
| **Key Vault Secrets User** | Read secrets | Apps via Managed/Workload Identity |
| **Storage Blob Data Contributor** | Read/write blobs | Apps, CI pipelines |

```hcl
# Assign the Workload Identity access to Key Vault secrets
resource "azurerm_role_assignment" "app_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Assign ACR pull to AKS kubelet identity
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
```

!!! tip "Avoid assignment sprawl"
    Assign roles to **Entra ID Groups**, not individual users or service principals. This makes role management auditable and avoids the N×M assignment matrix that appears in large organisations.

---

## Key Vault

Azure Key Vault stores secrets, encryption keys and certificates. It has built-in RBAC, soft delete, purge protection and access logging. Use it for everything — database passwords, API keys, TLS certificates, SSH keys.

### Key Vault objects

| Object type | Description | Typical use |
|------------|-------------|------------|
| **Secret** | Arbitrary string value | DB passwords, API keys, tokens |
| **Key** | RSA or EC cryptographic key | Envelope encryption, signing |
| **Certificate** | X.509 certificate + private key | TLS, mTLS |

```hcl
resource "azurerm_key_vault" "main" {
  name                      = "${var.project}-kv-${var.env}"
  resource_group_name       = azurerm_resource_group.main.name
  location                  = var.location
  tenant_id                 = data.azurerm_client_config.current.tenant_id
  sku_name                  = "standard"
  enable_rbac_authorization = true    # use RBAC, not access policies
  soft_delete_retention_days = 90
  purge_protection_enabled  = true   # prevents accidental permanent delete

  network_acls {
    bypass         = "AzureServices"
    default_action = "Deny"           # deny public, use Private Endpoint
    ip_rules       = var.allowed_cidrs
  }
}

resource "azurerm_key_vault_secret" "db_password" {
  name         = "db-password"
  value        = var.db_password
  key_vault_id = azurerm_key_vault.main.id
}
```

### Mount Key Vault secrets in AKS pods

Use the **Secrets Store CSI Driver** with the Azure Key Vault provider — secrets are mounted as files or synced to Kubernetes Secrets automatically.

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: app-secrets
spec:
  provider: azure
  parameters:
    usePodIdentity: "false"
    clientID: "<workload-identity-client-id>"
    keyvaultName: myproject-kv-prod
    tenantId: "<tenant-id>"
    objects: |
      array:
        - |
          objectName: db-password
          objectType: secret
  secretObjects:
    - secretName: app-secrets
      type: Opaque
      data:
        - objectName: db-password
          key: DB_PASSWORD
```

---

## Defender for Cloud

Defender for Cloud (formerly Azure Security Center) provides cloud security posture management (CSPM) and cloud workload protection (CWPP) across Azure, hybrid and multi-cloud.

### Defender plans

| Plan | Protects | Key detections |
|------|---------|---------------|
| **Defender for Servers** | VMs, Arc servers | Fileless attacks, brute force, Defender AV |
| **Defender for Containers** | AKS, Arc K8s | Image vulnerabilities, runtime threats, K8s API anomalies |
| **Defender for Storage** | Blob, ADLS Gen2 | Malware scanning, unusual access, anomalous upload |
| **Defender for Key Vault** | Key Vault | Unusual access patterns, high volume operations |
| **Defender for DevOps** | GitHub, ADO | Secret scanning, IaC misconfigurations, code vulnerabilities |

!!! tip "Secure Score"
    The **Secure Score** dashboard aggregates all recommendations into a single percentage. Treat it like a security backlog — prioritise recommendations with the highest score impact first. Use **Governance rules** to assign recommendations to owners with due dates.

---

## Azure Policy

Azure Policy enforces compliance on Azure resources — at creation time (deny), on existing resources (audit), or by automatically remediating drift. Assign policies at management group scope to enforce across all subscriptions in an organisation.

```hcl
# Deny public network access to Storage Accounts
resource "azurerm_policy_assignment" "deny_public_storage" {
  name                 = "deny-public-storage"
  scope                = data.azurerm_management_group.root.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/b2982f36-99f2-4db5-8eff-19bf0dfa0d45"
  display_name         = "Deny public network access to Storage Accounts"
  enforce              = true

  parameters = jsonencode({
    effect = { value = "Deny" }
  })
}

# Require Key Vault soft delete + purge protection
resource "azurerm_policy_assignment" "kv_protection" {
  name                 = "kv-soft-delete"
  scope                = data.azurerm_management_group.root.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/1e66c121-a66a-4b1f-9b83-0fd99bf0fc2d"
  display_name         = "Key vaults should have soft delete enabled"
  enforce              = true
}
```

### Policy initiative (policy set)

Group related policies into an **initiative** (formerly policy set) and assign the initiative as a single unit. Azure provides built-in initiatives for CIS, NIST 800-53, PCI-DSS compliance.

```hcl
resource "azurerm_policy_set_definition" "baseline" {
  name         = "security-baseline"
  display_name = "Security Baseline"
  policy_type  = "Custom"

  policy_definition_reference {
    policy_definition_id = azurerm_policy_definition.deny_public_storage.id
    parameter_values     = jsonencode({ effect = { value = "Deny" } })
  }
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/..."
  }
}
```

---

## Privileged Identity Management (PIM)

PIM provides just-in-time (JIT) privileged access to Entra ID roles and Azure RBAC roles. Users request elevation, provide a justification, and the access is time-bound (up to 8 hours) with an automatic expiry.

| PIM feature | Description |
|------------|-------------|
| **Eligible assignments** | User can activate the role on demand — not permanently active |
| **Active assignments** | Permanently active role — avoid for privileged roles |
| **Activation approval** | Require a second person to approve elevation |
| **Conditional Access on activation** | Require MFA or compliant device when activating |
| **Access reviews** | Periodic review of who has eligible assignments |

!!! warning "Always use PIM for Owner/Contributor"
    No persistent `Owner` or `Contributor` assignments at subscription scope. All elevated access should go through PIM with justification and time-bound activation — this is audited in Entra ID sign-in logs and PIM audit events.

---

[← Azure Overview](index.md){ .md-button }
[Observability →](observability.md){ .md-button .md-button--primary }
