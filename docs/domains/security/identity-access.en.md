---
title: Identity & Access
description: SPIFFE/SPIRE, zero-trust networking, workload identity, OIDC, RBAC and cloud IAM patterns.
---

<div class="domain-page-hero" data-domain="security">
  <div class="dph-left">
    <span class="dph-eyebrow">// security-devsecops / identity-access</span>
    <h1 class="dph-title">Identity & Access</h1>
    <p class="dph-desc">In a zero-trust model, every workload must prove its identity before accessing any resource — not just at the network perimeter. SPIFFE/SPIRE issues cryptographic workload identities; OIDC federates cloud IAM; Kubernetes RBAC governs the control plane.</p>
    <div class="dph-badges">
      <span class="tech-badge">SPIFFE/SPIRE</span>
      <span class="tech-badge">OIDC Federation</span>
      <span class="tech-badge">Kubernetes RBAC</span>
      <span class="tech-badge">Cloud IAM</span>
      <span class="tech-badge">Zero Trust</span>
      <span class="tech-badge">mTLS</span>
    </div>
  </div>
</div>

[← Vulnerability Scanning](vulnerability-scanning.md) | [← Security Overview](index.md) | [Supply Chain →](supply-chain.md)

---

## Zero-Trust Principles

```
Traditional perimeter:            Zero-Trust:
  ┌─────────────────────┐          Every request verified:
  │  Firewall           │          • Workload identity (SPIFFE SVID)
  │  ┌───────────────┐  │          • mTLS between all services
  │  │  Trust zone   │  │          • Short-lived credentials
  │  │  (implicit)   │  │          • Least-privilege RBAC
  │  └───────────────┘  │          • Continuous authorisation
  └─────────────────────┘          • No implicit trust, ever
```

---

## SPIFFE / SPIRE

SPIFFE (Secure Production Identity Framework for Everyone) defines a standard for workload identity. SPIRE is the reference implementation.

### Architecture

```
┌────────────────────────────────┐
│  SPIRE Server                  │
│  • Issues SVIDs (X.509/JWT)    │
│  • Manages node attestation    │
│  • Stores registration entries │
└──────────┬─────────────────────┘
           │ gRPC (node API)
    ┌──────▼───────────────────┐
    │  SPIRE Agent (DaemonSet) │
    │  • Node attestation      │
    │  • Workload attestation  │
    │  • Issues SVIDs via      │
    │    Workload API (UDS)    │
    └──────────────────────────┘
           │ Unix domain socket
    ┌──────▼───────────────────┐
    │  Workload (Pod)          │
    │  • Fetches SVID via API  │
    │  • Uses for mTLS / JWT   │
    └──────────────────────────┘
```

### Installation (Helm)

```bash
helm upgrade --install spire-crds spire/spire-crds \
  --namespace spire --create-namespace

helm upgrade --install spire spire/spire \
  --namespace spire \
  --values spire-values.yaml
```

```yaml
# spire-values.yaml
global:
  spire:
    trustDomain: prod.example.com
    clusterName: prod-cluster

spire-server:
  replicaCount: 3
  dataStore:
    database:
      connectionString: "postgresql://spire:${SPIRE_DB_PASSWORD}@postgres.spire.svc:5432/spire?sslmode=verify-full"

  nodeAttestor:
    k8sPsat:
      enabled: true

  ca:
    ttl: 24h
    keyType: rsa-2048

spire-agent:
  nodeAttestor:
    k8sPsat:
      enabled: true
  workloadAttestors:
    k8s:
      enabled: true
```

### Registration Entries

```bash
# Register a workload — SVID issued when pod matches all selectors
spire-server entry create \
  --spiffeID spiffe://prod.example.com/ns/production/sa/api-sa \
  --parentID spiffe://prod.example.com/k8s-node/node01 \
  --selector k8s:ns:production \
  --selector k8s:sa:api-sa \
  --selector k8s:pod-label:app:my-api

# List entries
spire-server entry show

# Fetch SVID (inside a pod with agent socket)
spiffe-helper -config /etc/spiffe-helper.conf &
# or use the Go/Python SDK:
```

```go
// Go — fetch X.509 SVID via Workload API
import (
    "github.com/spiffe/go-spiffe/v2/spiffetls/tlsconfig"
    "github.com/spiffe/go-spiffe/v2/workloadapi"
)

source, _ := workloadapi.NewX509Source(ctx,
    workloadapi.WithClientOptions(workloadapi.WithAddr("unix:///run/spire/sockets/agent.sock")),
)
defer source.Close()

// Use SVID for mTLS
tlsConfig := tlsconfig.MTLSClientConfig(source, source, tlsconfig.AuthorizeAny())
client := &http.Client{Transport: &http.Transport{TLSClientConfig: tlsConfig}}
```

---

## OIDC Workload Identity Federation

Replace long-lived cloud credentials with short-lived tokens issued via OIDC.

### GitHub Actions → AWS

```yaml
# No stored AWS credentials — OIDC token exchanged at runtime
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          role-session-name: github-deploy-${{ github.run_id }}
          aws-region: us-east-1
```

```hcl
# Terraform — trust policy for GitHub Actions OIDC
data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    actions = ["sts:AssumeRoleWithWebIdentity"]
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:my-org/my-repo:ref:refs/heads/main"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}
```

### Kubernetes ServiceAccount → AWS (IRSA)

```yaml
# Already covered in Managed Kubernetes — recap
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/app-role
    eks.amazonaws.com/token-expiration: "3600"   # 1 hour max
```

### Kubernetes ServiceAccount → GCP (Workload Identity)

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: production
  annotations:
    iam.gke.io/gcp-service-account: app@my-project.iam.gserviceaccount.com
```

---

## Kubernetes RBAC

### Principle of Least Privilege

```yaml
# Role — namespaced permissions
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: app-deployer
  namespace: production
rules:
  # Can read/update deployments and statefulsets
  - apiGroups: [apps]
    resources: [deployments, statefulsets]
    verbs: [get, list, watch, update, patch]
  # Can read pods and their logs
  - apiGroups: [""]
    resources: [pods, pods/log]
    verbs: [get, list, watch]
  # Can read but not write secrets
  - apiGroups: [""]
    resources: [secrets]
    verbs: [get, list]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-deployer-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: ci-runner
    namespace: ci-cd
roleRef:
  kind: Role
  name: app-deployer
  apiGroup: rbac.authorization.k8s.io
```

```yaml
# ClusterRole — cluster-wide read-only access
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: cluster-viewer
rules:
  - apiGroups: ["", apps, batch, extensions]
    resources: ["*"]
    verbs: [get, list, watch]
  - apiGroups: [rbac.authorization.k8s.io]
    resources: ["*"]
    verbs: [get, list, watch]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sre-team-viewer
subjects:
  - kind: Group
    name: sre-team          # matches OIDC group claim
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-viewer
  apiGroup: rbac.authorization.k8s.io
```

### RBAC Audit Commands

```bash
# Check what a user can do
kubectl auth can-i create deployments --as=system:serviceaccount:production:app-sa -n production
kubectl auth can-i --list --as=system:serviceaccount:production:app-sa -n production

# List all ClusterRoleBindings (audit over-permissioned subjects)
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | .metadata.name + " → " + (.subjects[]?.name // "none")'

# Who has cluster-admin?
kubectl get clusterrolebindings -o json | \
  jq -r '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]?.name'

# rbac-tool — visualise RBAC
kubectl rbac-tool policy-rules -n production
kubectl rbac-tool who-can create pods -n production
```

---

## Cloud IAM Best Practices

=== "AWS"

    ```hcl
    # Deny over-permissive wildcards via SCP
    resource "aws_organizations_policy" "deny_star_actions" {
      name = "deny-wildcard-actions"
      type = "SERVICE_CONTROL_POLICY"
      content = jsonencode({
        Version = "2012-10-17"
        Statement = [
          {
            Sid    = "DenyStarActions"
            Effect = "Deny"
            Action = ["iam:CreateAccessKey", "iam:*", "sts:*"]
            Resource = "*"
            Condition = {
              StringNotLike = {
                "aws:PrincipalArn" = "arn:aws:iam::*:role/BreakGlassRole"
              }
            }
          }
        ]
      })
    }

    # IAM Access Analyser — detect external exposure
    resource "aws_accessanalyzer_analyzer" "org" {
      analyzer_name = "org-analyser"
      type          = "ORGANIZATION"
    }
    ```

=== "GCP"

    ```bash
    # List all roles granted at project level
    gcloud projects get-iam-policy my-project \
      --format=json | jq '.bindings[] | {role, members}'

    # Detect overly permissive bindings
    gcloud policy-intelligence query-activity \
      --project=my-project \
      --activity-type=serviceAccountLastAuthentication

    # Enable IAM recommender
    gcloud recommender recommendations list \
      --project=my-project \
      --recommender=google.iam.policy.Recommender \
      --location=global
    ```

=== "Azure"

    ```bash
    # List all role assignments at subscription scope
    az role assignment list --scope /subscriptions/${SUBSCRIPTION_ID} -o table

    # Find over-permissive Owner assignments
    az role assignment list \
      --role Owner \
      --scope /subscriptions/${SUBSCRIPTION_ID}

    # Enable Azure AD PIM (Privileged Identity Management) for JIT access
    az rest --method POST \
      --uri "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleEligibilityScheduleRequests"
    ```

---

## mTLS with Istio (Zero-Trust Service Mesh)

```yaml
# Enforce STRICT mTLS across the entire mesh
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: istio-system        # mesh-wide
spec:
  mtls:
    mode: STRICT                 # reject plaintext connections
---
# Per-namespace override — allow permissive for legacy services
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: legacy-permissive
  namespace: legacy
spec:
  mtls:
    mode: PERMISSIVE
---
# AuthorizationPolicy — only allow api → database traffic
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: database-allow-api-only
  namespace: production
spec:
  selector:
    matchLabels:
      app: database
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/production/sa/api-sa"
      to:
        - operation:
            ports: ["5432"]
```

---

## Just-in-Time (JIT) Access

```bash
# Teleport — short-lived certificates for SSH/K8s/DB access
# No long-lived credentials; users authenticate via SSO
tsh login --proxy=teleport.internal:443 --auth=okta

# K8s access (time-limited kubeconfig)
tsh kube login prod-cluster

# Database access (ephemeral credentials)
tsh db login prod-postgres --db-user=readonly --db-name=appdb

# Audit who accessed what
tctl get sessions --namespace=production

# AWS access via Teleport Application Access
tsh app login aws-console
tsh aws s3 ls
```

[← Vulnerability Scanning](vulnerability-scanning.md) | [← Security Overview](index.md) | [Supply Chain →](supply-chain.md)
