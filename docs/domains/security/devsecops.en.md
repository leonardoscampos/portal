---
title: DevSecOps Pipelines
description: SAST, DAST, SCA, secrets scanning and security gates embedded in GitHub Actions, GitLab CI, and Tekton pipelines.
---

<div class="domain-page-hero" data-domain="security">
  <div class="dph-left">
    <span class="dph-eyebrow">// security-devsecops / devsecops-pipelines</span>
    <h1 class="dph-title">DevSecOps Pipelines</h1>
    <p class="dph-desc">Security checks automated as pipeline stages — not bolted on at the end. SAST catches code vulnerabilities at commit time, SCA identifies known CVEs in dependencies, secrets scanning prevents credential leaks, and DAST validates running applications before promotion.</p>
    <div class="dph-badges">
      <span class="tech-badge">SAST</span>
      <span class="tech-badge">DAST</span>
      <span class="tech-badge">SCA</span>
      <span class="tech-badge">Semgrep</span>
      <span class="tech-badge">OWASP ZAP</span>
      <span class="tech-badge">Secrets Scanning</span>
    </div>
  </div>
</div>

[← Security Overview](index.md) | [Secrets Management →](secrets.md)

---

## Security Pipeline Stages

```
┌─────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│  Commit │  │  Build   │  │  Test   │  │  Scan   │  │  Stage   │  │  Prod    │
│         │  │          │  │         │  │         │  │          │  │          │
│ secrets │  │ SAST     │  │ unit /  │  │ image   │  │ DAST     │  │ runtime  │
│ scan    │  │ lint     │  │ integ   │  │ SCA     │  │ pentest  │  │ Falco    │
│ pre-    │  │          │  │         │  │ SBOM    │  │          │  │ WAF      │
│ commit  │  │          │  │         │  │ sign    │  │          │  │          │
└─────────┘  └──────────┘  └─────────┘  └─────────┘  └──────────┘  └──────────┘
```

---

## GitHub Actions — Full Security Pipeline

```yaml
name: Security Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write   # for SARIF upload to GitHub Advanced Security
  id-token: write          # for OIDC / cosign

jobs:
  # ─── Secrets Scanning ────────────────────────────────────────────────────
  secrets-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # full history for git-based scanning

      - name: Gitleaks — detect secrets
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: TruffleHog — scan git history
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.repository.default_branch }}
          head: HEAD
          extra_args: --only-verified

  # ─── SAST ────────────────────────────────────────────────────────────────
  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Semgrep — SAST scan
        uses: semgrep/semgrep-action@v1
        with:
          config: >-
            p/default
            p/owasp-top-ten
            p/secrets
            p/docker
          generateSarif: "1"
        env:
          SEMGREP_APP_TOKEN: ${{ secrets.SEMGREP_APP_TOKEN }}

      - name: Upload Semgrep SARIF to GitHub
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: semgrep.sarif

      - name: CodeQL Analysis (compiled languages)
        uses: github/codeql-action/init@v3
        with:
          languages: go          # or: java, python, javascript, csharp
          queries: security-extended

  # ─── SCA — Dependency Vulnerabilities ────────────────────────────────────
  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Trivy — filesystem SCA
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          format: sarif
          output: trivy-sca.sarif
          severity: HIGH,CRITICAL
          exit-code: "1"         # fail build on HIGH/CRITICAL

      - name: Upload Trivy SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-sca.sarif

      - name: OWASP Dependency-Check
        uses: dependency-check/Dependency-Check_Action@main
        with:
          project: my-app
          path: .
          format: HTML
          args: --enableRetired

  # ─── Container Image Scan ────────────────────────────────────────────────
  image-scan:
    runs-on: ubuntu-latest
    needs: [sast, sca]
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: docker build -t my-app:${{ github.sha }} .

      - name: Trivy — image vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: my-app:${{ github.sha }}
          format: sarif
          output: trivy-image.sarif
          severity: HIGH,CRITICAL
          ignore-unfixed: true
          exit-code: "1"

      - name: Upload image scan SARIF
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-image.sarif

      - name: Generate SBOM (Syft)
        uses: anchore/sbom-action@v0
        with:
          image: my-app:${{ github.sha }}
          format: spdx-json
          output-file: sbom.spdx.json

      - name: Sign image with cosign (keyless / OIDC)
        uses: sigstore/cosign-installer@v3
      - run: |
          cosign sign --yes my-app:${{ github.sha }}
          cosign attest --yes \
            --predicate sbom.spdx.json \
            --type spdxjson \
            my-app:${{ github.sha }}

  # ─── IaC Security Scan ───────────────────────────────────────────────────
  iac-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Trivy — IaC config scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: .
          format: sarif
          output: trivy-iac.sarif
          severity: HIGH,CRITICAL

      - name: Checkov — Terraform / K8s / Dockerfile
        uses: bridgecrewio/checkov-action@master
        with:
          directory: .
          framework: terraform,kubernetes,dockerfile,github_actions
          output_format: sarif
          output_file_path: checkov.sarif
          soft_fail: false

      - name: Upload IaC scan results
        uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: trivy-iac.sarif

  # ─── DAST — Dynamic Testing ───────────────────────────────────────────────
  dast:
    runs-on: ubuntu-latest
    needs: [image-scan]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Start application (staging)
        run: docker compose -f docker-compose.staging.yml up -d

      - name: OWASP ZAP — baseline scan
        uses: zaproxy/action-baseline@v0.11.0
        with:
          target: http://localhost:8080
          rules_file_name: .zap/rules.tsv
          cmd_options: "-a"      # include ajax spider

      - name: Upload ZAP report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: zap-report
          path: report_html.html
```

---

## Semgrep Rules

```yaml
# .semgrep/custom-rules.yaml
rules:
  # Detect hardcoded credentials
  - id: hardcoded-secret
    patterns:
      - pattern: $KEY = "..."
      - metavariable-regex:
          metavariable: $KEY
          regex: '(?i)(password|secret|token|api_key|apikey|passwd)'
      - metavariable-regex:
          metavariable: "\"...\""
          regex: '.{8,}'        # non-empty value
    message: "Possible hardcoded secret in $KEY"
    languages: [python, go, javascript, java]
    severity: ERROR

  # SQL injection via string concat
  - id: sql-injection-string-format
    patterns:
      - pattern: |
          $DB.Query(fmt.Sprintf($QUERY, ...))
      - pattern-not: |
          $DB.Query(fmt.Sprintf($QUERY, $SAFE_PARAMS))
    message: "Potential SQL injection — use parameterised queries"
    languages: [go]
    severity: ERROR

  # Insecure TLS config
  - id: tls-insecure-skip-verify
    pattern: |
      tls.Config{..., InsecureSkipVerify: true, ...}
    message: "InsecureSkipVerify disables TLS certificate validation"
    languages: [go]
    severity: WARNING
```

---

## GitLab CI Security Template

```yaml
# .gitlab-ci.yml — include GitLab built-in security templates
include:
  - template: Security/SAST.gitlab-ci.yml
  - template: Security/Secret-Detection.gitlab-ci.yml
  - template: Security/Dependency-Scanning.gitlab-ci.yml
  - template: Security/Container-Scanning.gitlab-ci.yml
  - template: Security/DAST.gitlab-ci.yml

variables:
  SAST_EXCLUDED_PATHS: "spec, test, tests, tmp"
  SECRET_DETECTION_HISTORIC_SCAN: "true"
  CS_IMAGE: "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA"
  DAST_WEBSITE: "https://staging.example.com"
  DAST_FULL_SCAN_ENABLED: "false"

# Override severity thresholds
sast:
  variables:
    SAST_SEVERITY_LEVEL: high

container_scanning:
  variables:
    CS_SEVERITY_THRESHOLD: high
    CS_DISABLE_DEPENDENCY_LIST: "false"
```

---

## Pre-commit Hooks

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.4
    hooks:
      - id: gitleaks

  - repo: https://github.com/trufflesecurity/trufflehog
    rev: v3.78.1
    hooks:
      - id: trufflehog
        args: ["git", "file://.", "--since-commit", "HEAD", "--only-verified", "--fail"]

  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.92.0
    hooks:
      - id: terraform_validate
      - id: terraform_tflint
      - id: terraform_trivy

  - repo: https://github.com/hadolint/hadolint
    rev: v2.12.0
    hooks:
      - id: hadolint-docker
        args: ["--failure-threshold", "warning"]
```

```bash
# Install and run
pip install pre-commit
pre-commit install          # register git hook
pre-commit run --all-files  # run against all files
```

---

## Security Gate Policy

```yaml
# OPA policy — enforce minimum security checks before merge
# Evaluated by CI pipeline or GitHub Actions branch protection

package pipeline.security

import future.keywords.if
import future.keywords.every

# Block merge if any HIGH/CRITICAL vulnerabilities unfixed
deny[msg] if {
    some vuln in input.trivy.results[_].Vulnerabilities
    vuln.Severity in {"HIGH", "CRITICAL"}
    not vuln.FixedVersion == ""
    msg := sprintf("Fixable vulnerability %v (%v) — upgrade to %v",
        [vuln.VulnerabilityID, vuln.Severity, vuln.FixedVersion])
}

# Block if secrets detected
deny[msg] if {
    input.gitleaks.leaks != null
    count(input.gitleaks.leaks) > 0
    msg := "Secrets detected in commit — remove before merging"
}

# Block if SBOM not generated
deny[msg] if {
    not input.sbom
    msg := "SBOM artifact missing — ensure sbom-action ran successfully"
}
```

---

## Compliance as Code — Key Frameworks

| Framework | Scope | Tool |
|-----------|-------|------|
| CIS Benchmarks | OS, K8s, cloud accounts | `kube-bench`, `cloud-custodian` |
| NIST SP 800-53 | US federal controls | `OpenSCAP`, custom OPA policies |
| SOC 2 Type II | SaaS trust service criteria | `Vanta`, `Drata`, `Sprinto` |
| PCI DSS | Cardholder data environments | Segmentation + audit logging |
| GDPR | EU personal data | Data classification + encryption |
| SLSA | Supply chain integrity (4 levels) | Sigstore, OIDC provenance |

```bash
# kube-bench — CIS Kubernetes benchmark
kubectl apply -f https://raw.githubusercontent.com/aquasecurity/kube-bench/main/job.yaml
kubectl logs -l app=kube-bench

# cloud-custodian — AWS compliance rules
custodian run --output-dir=output policy.yaml
```

[← Security Overview](index.md) | [Secrets Management →](secrets.md)
