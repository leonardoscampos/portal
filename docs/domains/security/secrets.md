---
title: Gerenciamento de Segredos
description: HashiCorp Vault, External Secrets Operator, AWS Secrets Manager, SOPS — ciclo de vida de segredos sem credenciais no código.
---

<div class="domain-page-hero" data-domain="security">
  <div class="dph-left">
    <span class="dph-eyebrow">// security-devsecops / secrets-management</span>
    <h1 class="dph-title">Gerenciamento de Segredos</h1>
    <p class="dph-desc">Segredos pertencem a um cofre — não ao Git, variáveis de ambiente ou imagens de contêiner. O gerenciamento centralizado de segredos fornece criptografia em repouso, credenciais dinâmicas, rotação automática, registro de auditoria e controle de acesso granular para cada workload.</p>
    <div class="dph-badges">
      <span class="tech-badge">HashiCorp Vault</span>
      <span class="tech-badge">External Secrets Operator</span>
      <span class="tech-badge">AWS Secrets Manager</span>
      <span class="tech-badge">SOPS</span>
      <span class="tech-badge">Sealed Secrets</span>
      <span class="tech-badge">Secret Rotation</span>
    </div>
  </div>
</div>

[← Pipelines DevSecOps](devsecops.md) | [← Visão Geral de Segurança](index.md) | [Política como Código →](opa-policies.md)

---

## HashiCorp Vault

### Instalação (Helm — HA com Armazenamento Integrado)

```bash
helm repo add hashicorp https://helm.releases.hashicorp.com
helm repo update

helm upgrade --install vault hashicorp/vault \
  --namespace vault --create-namespace \
  --values vault-values.yaml
```

```yaml
# vault-values.yaml — HA with Raft integrated storage
server:
  ha:
    enabled: true
    replicas: 3
    raft:
      enabled: true
      setNodeId: true
      config: |
        ui = true
        listener "tcp" {
          tls_disable = 1
          address = "[::]:8200"
          cluster_address = "[::]:8201"
        }
        storage "raft" {
          path = "/vault/data"
          retry_join {
            leader_api_addr = "http://vault-0.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "http://vault-1.vault-internal:8200"
          }
          retry_join {
            leader_api_addr = "http://vault-2.vault-internal:8200"
          }
        }
        service_registration "kubernetes" {}

  dataStorage:
    enabled: true
    size: 10Gi
    storageClass: gp3

  resources:
    requests: { cpu: 250m, memory: 256Mi }
    limits:   { memory: 512Mi }

  affinity: |
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app.kubernetes.io/name: vault
          topologyKey: kubernetes.io/hostname

injector:
  enabled: true            # Vault Agent Injector (sidecar)
  resources:
    requests: { cpu: 50m, memory: 64Mi }
    limits:   { memory: 128Mi }

ui:
  enabled: true
  serviceType: ClusterIP
```

### Configuração Inicial

```bash
# Initialise (first time only)
kubectl exec -n vault vault-0 -- vault operator init \
  -key-shares=5 \
  -key-threshold=3 \
  -format=json > vault-keys.json   # STORE SECURELY — never in Git

# Unseal each node (3 of 5 keys required)
for i in 0 1 2; do
  for key in $(jq -r '.unseal_keys_b64[0:3][]' vault-keys.json); do
    kubectl exec -n vault vault-$i -- vault operator unseal "$key"
  done
done

# Authenticate with root token (initial only — rotate afterwards)
export VAULT_TOKEN=$(jq -r '.root_token' vault-keys.json)
kubectl exec -n vault vault-0 -- vault login "$VAULT_TOKEN"
```

### Motor de Segredos KV

```bash
# Enable KV v2
vault secrets enable -path=secret kv-v2

# Write a secret
vault kv put secret/production/database \
  username="app_user" \
  password="s3cure-p@ss!"

# Read a secret
vault kv get secret/production/database

# Read a specific version
vault kv get -version=2 secret/production/database

# List secrets
vault kv list secret/production/

# Patch (update one field without overwriting others)
vault kv patch secret/production/database password="new-p@ss"

# Soft-delete and undelete
vault kv delete secret/production/database
vault kv undelete -versions=2 secret/production/database
```

### Credenciais Dinâmicas de Banco de Dados

```bash
# Enable database secrets engine
vault secrets enable database

# Configure PostgreSQL connection
vault write database/config/prod-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="app-readonly,app-readwrite" \
  connection_url="postgresql://{{username}}:{{password}}@postgres.production.svc:5432/appdb?sslmode=verify-full" \
  username="vault_admin" \
  password="vault_admin_password" \
  root_rotation_statements="ALTER USER \"{{username}}\" WITH PASSWORD '{{password}}'"

# Create a role
vault write database/roles/app-readonly \
  db_name=prod-postgres \
  creation_statements="CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"{{name}}\";" \
  revocation_statements="DROP ROLE IF EXISTS \"{{name}}\";" \
  default_ttl=1h \
  max_ttl=4h

# Lease a dynamic credential
vault read database/creds/app-readonly
# Returns:
#   username: v-appro-KWk8O7hJn-1234567890
#   password: A1a-randompassword
#   lease_duration: 1h
```

### Autenticação Kubernetes + Política

```bash
# Enable Kubernetes auth
vault auth enable kubernetes

vault write auth/kubernetes/config \
  kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443"

# Create policy
vault policy write app-production - <<EOF
path "secret/data/production/*" {
  capabilities = ["read"]
}
path "database/creds/app-readonly" {
  capabilities = ["read"]
}
EOF

# Bind Kubernetes ServiceAccount to policy
vault write auth/kubernetes/role/app-production \
  bound_service_account_names=app-sa \
  bound_service_account_namespaces=production \
  policies=app-production \
  ttl=1h
```

### Vault Agent Injector (Sidecar)

```yaml
# Pod annotations — Vault Agent injects secrets as files
apiVersion: v1
kind: Pod
metadata:
  name: app
  namespace: production
  annotations:
    vault.hashicorp.com/agent-inject: "true"
    vault.hashicorp.com/role: "app-production"
    # Static KV secret
    vault.hashicorp.com/agent-inject-secret-config: "secret/data/production/database"
    vault.hashicorp.com/agent-inject-template-config: |
      {{- with secret "secret/data/production/database" -}}
      DB_USERNAME={{ .Data.data.username }}
      DB_PASSWORD={{ .Data.data.password }}
      {{- end }}
    # Dynamic DB creds — auto-renew before expiry
    vault.hashicorp.com/agent-inject-secret-db-creds: "database/creds/app-readonly"
    vault.hashicorp.com/agent-inject-template-db-creds: |
      {{- with secret "database/creds/app-readonly" -}}
      POSTGRES_USER={{ .Data.username }}
      POSTGRES_PASSWORD={{ .Data.password }}
      {{- end }}
spec:
  serviceAccountName: app-sa
  containers:
    - name: app
      image: my-app:latest
      # Secrets available at /vault/secrets/config and /vault/secrets/db-creds
      command: ["/bin/sh", "-c"]
      args:
        - |
          source /vault/secrets/config
          source /vault/secrets/db-creds
          exec /app/server
```

---

## External Secrets Operator (ESO)

O ESO sincroniza segredos de provedores externos (AWS, Azure, GCP, Vault) para Kubernetes Secrets — sem agentes sidecar.

```bash
helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --set installCRDs=true
```

### SecretStore — AWS Secrets Manager

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets-sa
            namespace: external-secrets
```

### ExternalSecret

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-database-secret
  namespace: production
spec:
  refreshInterval: 1h              # re-sync interval

  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore

  target:
    name: database-credentials     # name of resulting K8s Secret
    creationPolicy: Owner
    template:
      engineVersion: v2
      data:
        POSTGRES_USER:     "{{ .username }}"
        POSTGRES_PASSWORD: "{{ .password }}"
        POSTGRES_HOST:     "{{ .host }}"

  data:
    - secretKey: username
      remoteRef:
        key: production/app/database
        property: username
    - secretKey: password
      remoteRef:
        key: production/app/database
        property: password
    - secretKey: host
      remoteRef:
        key: production/app/database
        property: host
```

### PushSecret — escrever K8s Secret de volta para um provedor

```yaml
apiVersion: external-secrets.io/v1alpha1
kind: PushSecret
metadata:
  name: generated-cert
  namespace: production
spec:
  refreshInterval: 10m
  secretStoreRefs:
    - name: aws-secrets-manager
      kind: ClusterSecretStore
  selector:
    secret:
      name: tls-cert
  data:
    - match:
        secretKey: tls.crt
        remoteRef:
          remoteKey: production/app/tls-cert
          property: cert
    - match:
        secretKey: tls.key
        remoteRef:
          remoteKey: production/app/tls-cert
          property: key
```

---

## SOPS — Segredos no Git (Criptografados)

```bash
# Install
brew install sops age

# Generate age key pair
age-keygen -o age.key
# Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p

# Encrypt a secrets file
SOPS_AGE_RECIPIENTS=age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p \
  sops --encrypt --age age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p \
  secrets.yaml > secrets.enc.yaml

# Decrypt (requires private key in SOPS_AGE_KEY_FILE)
SOPS_AGE_KEY_FILE=age.key sops --decrypt secrets.enc.yaml

# Edit in place (opens $EDITOR, saves re-encrypted)
SOPS_AGE_KEY_FILE=age.key sops secrets.enc.yaml
```

```yaml
# .sops.yaml — automatic encryption rules
creation_rules:
  - path_regex: environments/production/.*\.yaml$
    age: age1prod...
    kms: arn:aws:kms:us-east-1:123456789012:key/mrk-xxx

  - path_regex: environments/staging/.*\.yaml$
    age: age1staging...

  - path_regex: .*\.yaml$
    age: age1dev...
```

```yaml
# Helm + SOPS via helm-secrets plugin
helm plugin install https://github.com/jkroepke/helm-secrets

# Deploy with encrypted values
helm secrets upgrade --install my-app ./chart \
  -f values.yaml \
  -f secrets://environments/production/secrets.enc.yaml
```

---

## Sealed Secrets (nativo para GitOps)

```bash
# Install controller
helm upgrade --install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system

# Install kubeseal CLI
brew install kubeseal

# Seal a K8s Secret for GitOps storage
kubectl create secret generic db-creds \
  --from-literal=password=s3cure-pass \
  --dry-run=client -o yaml | \
  kubeseal \
    --controller-namespace=kube-system \
    --controller-name=sealed-secrets-controller \
    --format=yaml > sealed-db-creds.yaml

# Commit sealed-db-creds.yaml to Git safely
git add sealed-db-creds.yaml
```

---

## Boas Práticas de Rotação de Segredos

| Padrão | Implementação |
|---------|---------------|
| **TTLs Curtos** | Use credenciais dinâmicas (motor de BD do Vault) com TTL de 1–4 h |
| **Rotação em caso de vazamento** | Automatize via Vault TOTP / Lambda de rotação do AWS Secrets Manager |
| **Rotação sem interrupção** | Conceda novas credenciais antes de revogar as antigas (handoff gradual) |
| **Trilha de auditoria** | Ative o backend de auditoria do Vault; encaminhe para o SIEM |
| **Acesso de emergência** | Armazene chaves de unsealing em HSM de hardware / custódia dividida |
| **Sem segredos em variáveis de ambiente** | Monte como arquivos de `/vault/secrets/` ou volume K8s Secret |
| **Detectar vazamentos** | Execute Gitleaks / TruffleHog no pre-commit e CI |

[← Pipelines DevSecOps](devsecops.md) | [← Visão Geral de Segurança](index.md) | [Política como Código →](opa-policies.md)
