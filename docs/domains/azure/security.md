---
title: Azure Security & IAM
description: Entra ID, RBAC, Key Vault, Defender for Cloud, Azure Policy, PIM — segurança no Azure.
---

<div class="domain-page-hero" data-domain="cloud">
  <div class="dph-left">
    <span class="dph-eyebrow">// azure / security</span>
    <h1 class="dph-title">Azure Security &amp; IAM</h1>
    <p class="dph-desc">Entra ID é a espinha dorsal de identidade do Azure — toda chamada de API é autenticada por ele. Combine RBAC com Workload Identity para pods AKS sem segredos, centralize segredos no Key Vault, aplique Conformidade com Azure Policy e obtenha visibilidade de postura na nuvem com Defender for Cloud.</p>
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

## Microsoft Entra ID (anteriormente Azure AD)

Entra ID é o provedor de identidade do Azure — gerencia a autenticação (quem você é) para todos os serviços do Azure. A autorização é gerenciada pelo Azure RBAC (o que você pode fazer).

### Primitivas de identidade principais

| Primitiva | Descrição |
|-----------|-----------|
| **User** | Identidades humanas, sincronizadas do AD on-premises ou apenas na nuvem |
| **Service Principal** | Identidade de aplicação — usada por automações, Terraform, pipelines de CI |
| **Managed Identity** | Identidade atribuída pelo sistema ou pelo usuário para recursos do Azure (sem gerenciamento de credenciais) |
| **Workload Identity** | Federação OIDC para pods Kubernetes — substitui o aad-pod-identity |
| **Groups** | Atribua funções RBAC a grupos, não a identidades individuais |
| **App Registration** | Registro de cliente OAuth 2.0 / OIDC |

### Fluxos de autenticação para automação

```
Terraform / pipeline de CI
  → Service Principal (client ID + segredo ou credencial federada)
  → Token do Entra ID
  → API do Azure Resource Manager

Pod do AKS
  → Workload Identity (token do volume projetado OIDC)
  → Entra ID valida o token contra o emissor OIDC do AKS
  → Retorna token de acesso para Key Vault / Storage / etc.
```

---

## Azure RBAC

O Azure RBAC controla quem pode realizar quais ações em quais recursos. As atribuições têm escopo: Grupo de Gerenciamento → Assinatura → Grupo de Recursos → Recurso.

### Funções integradas

| Função | Escopo | Caso de uso |
|--------|--------|-------------|
| **Owner** | Controle total + gerenciamento de RBAC | Evitar; prefira Contributor |
| **Contributor** | Controle total de recursos, sem RBAC | Líder da equipe de aplicação |
| **Reader** | Somente leitura | Auditores, etapas de CI somente leitura |
| **AKS Cluster Admin** | Acesso total ao kubectl | Apenas break-glass |
| **AKS Azure RBAC Admin** | Gerenciamento de RBAC no cluster | Operadores do cluster |
| **Key Vault Secrets User** | Leitura de segredos | Apps via Managed/Workload Identity |
| **Storage Blob Data Contributor** | Leitura/escrita de blobs | Apps, pipelines de CI |

```hcl
# Atribuir à Workload Identity acesso aos segredos do Key Vault
resource "azurerm_role_assignment" "app_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Atribuir ACR pull à identidade kubelet do AKS
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
```

!!! tip "Evite proliferação de atribuições"
    Atribua funções a **Grupos do Entra ID**, não a usuários individuais ou service principals. Isso torna o gerenciamento de funções auditável e evita a matriz N×M de atribuições que surge em grandes organizações.

---

## Key Vault

Azure Key Vault armazena segredos, chaves de criptografia e certificados. Possui RBAC integrado, exclusão reversível, proteção contra limpeza e registro de acessos. Use-o para tudo — senhas de banco de dados, chaves de API, certificados TLS, chaves SSH.

### Objetos do Key Vault

| Tipo de objeto | Descrição | Uso típico |
|----------------|-----------|------------|
| **Secret** | Valor de string arbitrário | Senhas de BD, chaves de API, tokens |
| **Key** | Chave criptográfica RSA ou EC | Criptografia de envelope, assinatura |
| **Certificate** | Certificado X.509 + chave privada | TLS, mTLS |

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

### Montar segredos do Key Vault em pods do AKS

Use o **Secrets Store CSI Driver** com o provedor do Azure Key Vault — os segredos são montados como arquivos ou sincronizados com Kubernetes Secrets automaticamente.

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

Defender for Cloud (anteriormente Azure Security Center) fornece gerenciamento de postura de segurança na nuvem (CSPM) e proteção de cargas de trabalho na nuvem (CWPP) no Azure, em ambientes híbridos e multinuvem.

### Planos do Defender

| Plano | Protege | Detecções principais |
|-------|---------|----------------------|
| **Defender for Servers** | VMs, servidores Arc | Ataques sem arquivo, força bruta, Defender AV |
| **Defender for Containers** | AKS, Arc K8s | Vulnerabilidades em imagens, ameaças em tempo de execução, anomalias na API do K8s |
| **Defender for Storage** | Blob, ADLS Gen2 | Varredura de malware, acesso incomum, upload anômalo |
| **Defender for Key Vault** | Key Vault | Padrões de acesso incomuns, operações em alto volume |
| **Defender for DevOps** | GitHub, ADO | Varredura de segredos, configurações incorretas de IaC, vulnerabilidades de código |

!!! tip "Pontuação de Segurança"
    O painel de **Pontuação de Segurança** agrega todas as recomendações em um único percentual. Trate-o como um backlog de segurança — priorize as recomendações com maior impacto na pontuação primeiro. Use **Regras de Governança** para atribuir recomendações a responsáveis com prazos.

---

## Azure Policy

Azure Policy aplica Conformidade nos recursos do Azure — no momento da criação (negar), em recursos existentes (auditar) ou corrigindo desvios automaticamente. Atribua políticas no escopo do grupo de gerenciamento para aplicar em todas as assinaturas de uma organização.

```hcl
# Negar acesso público à rede em Contas de Armazenamento
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

# Exigir exclusão reversível + proteção contra limpeza no Key Vault
resource "azurerm_policy_assignment" "kv_protection" {
  name                 = "kv-soft-delete"
  scope                = data.azurerm_management_group.root.id
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/1e66c121-a66a-4b1f-9b83-0fd99bf0fc2d"
  display_name         = "Key vaults should have soft delete enabled"
  enforce              = true
}
```

### Iniciativa de Política (conjunto de políticas)

Agrupe políticas relacionadas em uma **iniciativa** (anteriormente conjunto de políticas) e atribua a iniciativa como uma unidade única. O Azure fornece iniciativas integradas para Conformidade com CIS, NIST 800-53 e PCI-DSS.

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

O PIM fornece acesso privilegiado just-in-time (JIT) a funções do Entra ID e funções do Azure RBAC. Os usuários solicitam elevação, fornecem uma justificativa e o acesso é limitado no tempo (até 8 horas) com expiração automática.

| Recurso do PIM | Descrição |
|----------------|-----------|
| **Atribuições elegíveis** | O usuário pode ativar a função sob demanda — não permanentemente ativa |
| **Atribuições ativas** | Função permanentemente ativa — evitar para funções privilegiadas |
| **Aprovação de ativação** | Exigir que uma segunda pessoa aprove a elevação |
| **Acesso Condicional na ativação** | Exigir MFA ou dispositivo em conformidade ao ativar |
| **Revisões de acesso** | Revisão periódica de quem possui atribuições elegíveis |

!!! warning "Sempre use PIM para Owner/Contributor"
    Nenhuma atribuição persistente de `Owner` ou `Contributor` no escopo da assinatura. Todo acesso elevado deve passar pelo PIM com justificativa e ativação limitada no tempo — isso fica auditado nos logs de entrada do Entra ID e nos eventos de auditoria do PIM.

---

[← Visão Geral Azure](index.md){ .md-button }
[Observabilidade →](observability.md){ .md-button .md-button--primary }
