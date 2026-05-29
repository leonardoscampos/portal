---
title: Container Security
description: Pod Security Standards, OPA Gatekeeper, Kyverno, Trivy, Falco and runtime defense reference for Kubernetes.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / container-security</span>
    <h1 class="dph-title">Container Security</h1>
    <p class="dph-desc">Defense-in-depth for containerized workloads. Pod Security Standards enforce baseline hardening, OPA Gatekeeper and Kyverno provide policy-as-code admission control, Trivy scans for vulnerabilities, and Falco detects runtime threats in real time.</p>
    <div class="dph-badges">
      <span class="tech-badge">Pod Security Standards</span>
      <span class="tech-badge">OPA Gatekeeper</span>
      <span class="tech-badge">Kyverno</span>
      <span class="tech-badge">Trivy</span>
      <span class="tech-badge">Falco</span>
      <span class="tech-badge">Seccomp</span>
    </div>
  </div>
</div>

[← Operators](operators.md) | [← Containers Overview](index.md) | [Managed Kubernetes →](managed-kubernetes.md)

---

## Security Layers

| Layer | Tool / Mechanism |
|-------|-----------------|
| **Image build** | Trivy, Snyk, Docker Scout — scan before push |
| **Registry** | Image signing (cosign), content trust, ECR/ACR scan-on-push |
| **Admission** | OPA Gatekeeper, Kyverno — enforce policy before objects persist |
| **Runtime enforcement** | Pod Security Standards, seccomp, AppArmor, capabilities |
| **Runtime detection** | Falco — real-time syscall monitoring |
| **Network** | NetworkPolicy, mTLS (Istio/Linkerd) |
| **Secrets** | External Secrets Operator, Sealed Secrets, Vault Agent |
| **RBAC** | Least-privilege ServiceAccounts, audit logs |

---

## Pod Security Standards

Three built-in policy levels applied via namespace labels:

| Level | Restriction |
|-------|-------------|
| **privileged** | Unrestricted (for system namespaces only) |
| **baseline** | Prevents known privilege escalation; allows most workloads |
| **restricted** | Hardened — requires non-root, drops all capabilities, no hostPath |

```bash
# Enforce restricted policy on a namespace
kubectl label namespace production \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

```yaml
# Pod that satisfies "restricted" PSS
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 65532
    runAsGroup: 65532
    fsGroup: 65532
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: [ALL]
```

---

## OPA Gatekeeper

```bash
# Install
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helm install gatekeeper gatekeeper/gatekeeper \
  --namespace gatekeeper-system \
  --create-namespace \
  --set replicas=3
```

### ConstraintTemplate (Rego policy)

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels
spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels
      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8srequiredlabels

        violation[{"msg": msg}] {
          provided := {label | input.review.object.metadata.labels[label]}
          required := {label | label := input.parameters.labels[_]}
          missing  := required - provided
          count(missing) > 0
          msg := sprintf("Missing required labels: %v", [missing])
        }
```

```yaml
# Constraint — apply the policy
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
  name: require-app-labels
spec:
  enforcementAction: deny           # or: warn, dryrun
  match:
    kinds:
      - apiGroups: ["apps"]
        kinds: [Deployment, StatefulSet]
    namespaces: [production, staging]
  parameters:
    labels: [app, version, team]
```

### Common Gatekeeper Policies

```yaml
# Require resource limits
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8scontainerlimits
spec:
  crd:
    spec:
      names:
        kind: K8sContainerLimits
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8scontainerlimits
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          not container.resources.limits.memory
          msg := sprintf("Container '%v' has no memory limit", [container.name])
        }

---
# Block latest image tag
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8sdisallowedtags
spec:
  crd:
    spec:
      names:
        kind: K8sDisallowedTags
      validation:
        openAPIV3Schema:
          type: object
          properties:
            tags:
              type: array
              items:
                type: string
  targets:
    - target: admission.k8s.gatekeeper.sh
      rego: |
        package k8sdisallowedtags
        violation[{"msg": msg}] {
          container := input.review.object.spec.containers[_]
          tag := [t | t := split(container.image, ":")[1]]
          disallowed := {t | t := input.parameters.tags[_]}
          count(tag & disallowed) > 0
          msg := sprintf("Container '%v' uses disallowed tag: %v", [container.name, tag])
        }
```

---

## Kyverno

```bash
# Install
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno \
  --namespace kyverno \
  --create-namespace \
  --set replicaCount=3
```

### ClusterPolicy Examples

```yaml
# Require non-root and drop ALL capabilities
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-pod-security-baseline
spec:
  validationFailureAction: Enforce
  background: true
  rules:
    - name: require-non-root
      match:
        any:
          - resources:
              kinds: [Pod]
              namespaces: [production, staging]
      validate:
        message: "Pods must run as non-root"
        pattern:
          spec:
            securityContext:
              runAsNonRoot: true
            containers:
              - securityContext:
                  allowPrivilegeEscalation: false
                  capabilities:
                    drop: ["ALL"]

---
# Auto-add labels and annotations (mutate)
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: add-labels
spec:
  rules:
    - name: add-team-label
      match:
        any:
          - resources:
              kinds: [Deployment, StatefulSet]
      mutate:
        patchStrategicMerge:
          metadata:
            labels:
              managed-by: kyverno
          spec:
            template:
              metadata:
                annotations:
                  kyverno.io/managed: "true"

---
# Generate a default NetworkPolicy per namespace
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: default-network-policy
spec:
  rules:
    - name: default-deny-ingress
      match:
        any:
          - resources:
              kinds: [Namespace]
      generate:
        apiVersion: networking.k8s.io/v1
        kind: NetworkPolicy
        name: default-deny-ingress
        namespace: "{{request.object.metadata.name}}"
        data:
          spec:
            podSelector: {}
            policyTypes: [Ingress]

---
# Block image registries not in allowlist
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registries
spec:
  validationFailureAction: Enforce
  rules:
    - name: validate-registries
      match:
        any:
          - resources:
              kinds: [Pod]
      validate:
        message: "Images must come from approved registries"
        pattern:
          spec:
            containers:
              - image: "ghcr.io/* | 123456789012.dkr.ecr.us-east-1.amazonaws.com/*"
```

---

## Trivy — Vulnerability Scanning

```bash
# Scan a container image
trivy image ghcr.io/my-org/api:1.2.3

# Scan with severity filter
trivy image --severity HIGH,CRITICAL ghcr.io/my-org/api:1.2.3

# Scan and output SARIF (for GitHub Code Scanning)
trivy image --format sarif --output trivy-results.sarif ghcr.io/my-org/api:1.2.3

# Scan Dockerfile for misconfigurations
trivy config Dockerfile

# Scan K8s manifests
trivy config ./manifests/

# Scan Helm chart
trivy config ./helm/

# Scan live cluster
trivy k8s --report=summary cluster

# Scan filesystem (in CI before build)
trivy fs --scanners vuln,secret,misconfig .
```

```yaml
# GitHub Actions — scan on every PR
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
    format: sarif
    output: trivy-results.sarif
    severity: HIGH,CRITICAL
    exit-code: '1'             # fail the pipeline

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: trivy-results.sarif
```

---

## Falco — Runtime Threat Detection

```bash
# Install via Helm (eBPF driver — recommended)
helm repo add falcosecurity https://falcosecurity.github.io/charts
helm install falco falcosecurity/falco \
  --namespace falco \
  --create-namespace \
  --set driver.kind=ebpf \
  --set falcosidekick.enabled=true \
  --set falcosidekick.config.slack.webhookurl="https://hooks.slack.com/..."
```

### Custom Falco Rules

```yaml
# /etc/falco/rules.d/custom.yaml
- rule: Shell spawned in container
  desc: Detect shell execution inside a running container
  condition: >
    spawned_process
    and container
    and container.image.repository != "debug-tools"
    and (proc.name in (shell_binaries) or proc.name = "bash")
  output: >
    Shell spawned in container
    (user=%user.name user_loginuid=%user.loginuid
     container=%container.name image=%container.image.repository
     shell=%proc.name parent=%proc.pname cmdline=%proc.cmdline)
  priority: WARNING
  tags: [container, shell, T1059]

- rule: Sensitive file read
  desc: Detect read of sensitive files outside expected processes
  condition: >
    open_read
    and container
    and fd.name in (/etc/shadow, /etc/passwd, /root/.ssh/id_rsa)
    and not proc.name in (sshd, systemd)
  output: >
    Sensitive file read
    (file=%fd.name user=%user.name container=%container.name)
  priority: CRITICAL

- rule: Crypto mining activity
  desc: Detect crypto mining via known pool connections
  condition: >
    outbound
    and fd.sip.name in (crypto_mining_domains)
    and container
  output: >
    Crypto mining connection detected
    (container=%container.name image=%container.image.repository
     dest=%fd.rip:%fd.rport)
  priority: CRITICAL
  tags: [network, crypto-mining, T1496]
```

---

## Seccomp Profiles

```yaml
# Use the runtime default seccomp profile (recommended)
spec:
  securityContext:
    seccompProfile:
      type: RuntimeDefault     # uses containerd/runc defaults

---
# Custom seccomp profile (locked down to exact syscalls)
# Store profile in /var/lib/kubelet/seccomp/profiles/my-app.json
spec:
  securityContext:
    seccompProfile:
      type: Localhost
      localhostProfile: profiles/my-app.json
```

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
  "syscalls": [
    {
      "names": ["read", "write", "open", "close", "stat", "mmap",
                "mprotect", "munmap", "brk", "rt_sigaction",
                "rt_sigreturn", "ioctl", "access", "pipe",
                "select", "sched_yield", "mremap", "nanosleep",
                "getpid", "socket", "connect", "accept", "sendto",
                "recvfrom", "bind", "listen", "getsockname",
                "getpeername", "socketpair", "setsockopt",
                "getsockopt", "clone", "fork", "wait4",
                "kill", "uname", "fcntl", "getcwd", "chdir",
                "rename", "mkdir", "rmdir", "unlink", "readlink",
                "chmod", "getuid", "getgid", "geteuid", "getegid",
                "getppid", "getpgrp", "setsid", "setuid", "setgid",
                "prctl", "arch_prctl", "set_tid_address",
                "exit_group", "futex", "epoll_create1",
                "epoll_ctl", "epoll_wait", "openat", "newfstatat"],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

---

## Image Signing with Cosign

```bash
# Generate key pair
cosign generate-key-pair

# Sign an image (keyless — OIDC identity)
cosign sign ghcr.io/my-org/api:1.2.3

# Sign with key
cosign sign --key cosign.key ghcr.io/my-org/api:1.2.3

# Verify
cosign verify --key cosign.pub ghcr.io/my-org/api:1.2.3

# Attach SBOM
syft packages ghcr.io/my-org/api:1.2.3 -o spdx-json > sbom.spdx.json
cosign attach sbom --sbom sbom.spdx.json ghcr.io/my-org/api:1.2.3

# Verify SBOM
cosign verify-attestation \
  --key cosign.pub \
  --type spdxjson \
  ghcr.io/my-org/api:1.2.3
```

---

## Security Checklist

| Check | Tool |
|-------|------|
| Images have no HIGH/CRITICAL CVEs | Trivy |
| No secrets in image layers | Trivy (secret scan) |
| Images are signed | cosign |
| SBOM attached and verified | syft + cosign |
| Pods run as non-root | PSS restricted / Kyverno |
| Read-only root filesystem | PSS restricted / Kyverno |
| All capabilities dropped | PSS restricted / Kyverno |
| No privileged containers | OPA Gatekeeper |
| Resource limits set | OPA Gatekeeper / Kyverno |
| Images from approved registries | Kyverno |
| Seccomp RuntimeDefault | PSS restricted |
| NetworkPolicies in place | kubectl |
| mTLS between services | Istio / Linkerd |
| Runtime threats monitored | Falco |
| RBAC least-privilege | kubectl auth can-i --list |
| Secrets from external store | External Secrets Operator |
| Audit logs enabled | K8s audit policy |

[← Operators](operators.md) | [← Containers Overview](index.md) | [Managed Kubernetes →](managed-kubernetes.md)
