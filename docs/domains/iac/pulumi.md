---
title: Pulumi
description: Pulumi multi-language IaC, state management, Pulumi ESC and stack references reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / pulumi</span>
    <h1 class="dph-title">Pulumi</h1>
    <p class="dph-desc">Infrastructure as Code using general-purpose languages — TypeScript, Python, Go, Java and .NET. Pulumi integrates natively with package managers, test frameworks and IDEs, enabling software engineering best practices for infrastructure.</p>
    <div class="dph-badges">
      <span class="tech-badge">TypeScript</span>
      <span class="tech-badge">Python</span>
      <span class="tech-badge">Go</span>
      <span class="tech-badge">State</span>
      <span class="tech-badge">Pulumi ESC</span>
      <span class="tech-badge">Stack References</span>
    </div>
  </div>
</div>

[← CloudFormation](cloudformation.md) | [← IaC Overview](index.md) | [Helm →](helm.md)

---

## Pulumi vs Terraform

| Dimension | Pulumi | Terraform |
|-----------|--------|-----------|
| **Language** | TypeScript, Python, Go, Java, .NET | HCL (domain-specific) |
| **IDE support** | Full autocomplete, type checking, refactoring | Plugin-based, basic |
| **Testing** | Native unit/integration test frameworks | Terratest (Go) |
| **State** | Pulumi Cloud, S3, GCS, Azure Blob, local | Same backends |
| **Loops / conditionals** | Native language constructs | `count`, `for_each`, `dynamic` |
| **Provider coverage** | 130+ (including Terraform provider bridge) | 3,000+ native providers |
| **Learning curve** | Lower for devs, higher for ops | Higher for devs, familiar for ops |
| **Secrets** | Pulumi ESC, encrypted in state | External (Vault, env vars) |

---

## Project Structure

```
my-infra/
├── Pulumi.yaml          # project metadata
├── Pulumi.dev.yaml      # dev stack config
├── Pulumi.prod.yaml     # prod stack config
├── index.ts             # entrypoint (TypeScript)
├── package.json
└── tsconfig.json
```

```yaml
# Pulumi.yaml
name: my-infra
runtime: nodejs
description: "Core cloud infrastructure"
```

```yaml
# Pulumi.prod.yaml
config:
  aws:region: us-east-1
  my-infra:environment: prod
  my-infra:instanceType: m6i.large
```

---

## TypeScript Example — EKS Cluster

```typescript
// index.ts
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";

const config = new pulumi.Config();
const environment = config.require("environment");

// VPC
const vpc = new aws.ec2.Vpc("vpc", {
  cidrBlock: "10.0.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: `${environment}-vpc`, Environment: environment },
});

const privateSubnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"].map(
  (cidr, i) =>
    new aws.ec2.Subnet(`private-${i}`, {
      vpcId: vpc.id,
      cidrBlock: cidr,
      availabilityZone: pulumi.output(aws.getAvailabilityZones()).names[i],
      tags: {
        Name: `${environment}-private-${i}`,
        "kubernetes.io/role/internal-elb": "1",
      },
    })
);

// EKS cluster
const cluster = new eks.Cluster("eks", {
  vpcId: vpc.id,
  subnetIds: privateSubnets.map((s) => s.id),
  instanceType: config.get("instanceType") ?? "t3.medium",
  desiredCapacity: 3,
  minSize: 2,
  maxSize: 10,
  enabledClusterLogTypes: ["api", "audit", "authenticator"],
  tags: { Environment: environment },
});

export const kubeconfig = cluster.kubeconfig;
export const clusterName = cluster.eksCluster.name;
```

---

## Python Example — S3 + CloudFront

```python
# __main__.py
import pulumi
import pulumi_aws as aws

config = pulumi.Config()
environment = config.require("environment")

bucket = aws.s3.BucketV2(
    "site",
    tags={"Environment": environment},
)

aws.s3.BucketVersioningV2(
    "site-versioning",
    bucket=bucket.id,
    versioning_configuration=aws.s3.BucketVersioningV2VersioningConfigurationArgs(
        status="Enabled",
    ),
)

oac = aws.cloudfront.OriginAccessControl(
    "oac",
    origin_access_control_origin_type="s3",
    signing_behavior="always",
    signing_protocol="sigv4",
)

distribution = aws.cloudfront.Distribution(
    "cdn",
    origins=[aws.cloudfront.DistributionOriginArgs(
        domain_name=bucket.bucket_regional_domain_name,
        origin_id="s3-origin",
        origin_access_control_id=oac.id,
    )],
    enabled=True,
    default_root_object="index.html",
    default_cache_behavior=aws.cloudfront.DistributionDefaultCacheBehaviorArgs(
        viewer_protocol_policy="redirect-to-https",
        allowed_methods=["GET", "HEAD"],
        cached_methods=["GET", "HEAD"],
        target_origin_id="s3-origin",
        forwarded_values=aws.cloudfront.DistributionDefaultCacheBehaviorForwardedValuesArgs(
            query_string=False,
            cookies=aws.cloudfront.DistributionDefaultCacheBehaviorForwardedValuesCookiesArgs(
                forward="none",
            ),
        ),
    ),
    restrictions=aws.cloudfront.DistributionRestrictionsArgs(
        geo_restriction=aws.cloudfront.DistributionRestrictionsGeoRestrictionArgs(
            restriction_type="none",
        ),
    ),
    viewer_certificate=aws.cloudfront.DistributionViewerCertificateArgs(
        cloudfront_default_certificate=True,
    ),
    tags={"Environment": environment},
)

pulumi.export("bucket_name", bucket.id)
pulumi.export("cdn_domain", distribution.domain_name)
```

---

## State Backends

=== "Pulumi Cloud (default)"

    ```bash
    pulumi login           # login to Pulumi Cloud
    pulumi stack init prod
    ```

=== "S3"

    ```bash
    pulumi login s3://my-pulumi-state-bucket/prod
    ```

=== "Local"

    ```bash
    pulumi login --local
    ```

```bash
# Migrate state between backends
pulumi stack export --file stack.json
pulumi login s3://new-bucket
pulumi stack import --file stack.json
```

---

## Stack References

Stack references allow outputs from one stack to be consumed by another — the Pulumi equivalent of `terraform_remote_state`.

```typescript
// networking stack exports:
export const vpcId = vpc.id;
export const privateSubnetIds = privateSubnets.map(s => s.id);
```

```typescript
// eks stack consumes networking outputs:
import * as pulumi from "@pulumi/pulumi";

const networking = new pulumi.StackReference("org/networking/prod");

const vpcId = networking.requireOutput("vpcId");
const subnetIds = networking.requireOutput("privateSubnetIds");
```

---

## Pulumi ESC (Environments, Secrets & Configuration)

Pulumi ESC centralises secrets and configuration — across Pulumi stacks and any other tool (env files, K8s, Terraform).

```yaml
# .esc/prod.yaml
values:
  aws:
    creds:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: arn:aws:iam::123456789012:role/PulumiESCRole
          sessionName: pulumi-esc

  db:
    password:
      fn::secret: "{{secrets.db_password}}"

  environmentVariables:
    AWS_ACCESS_KEY_ID: ${aws.creds.keyId}
    AWS_SECRET_ACCESS_KEY: ${aws.creds.secretAccessKey}
    AWS_SESSION_TOKEN: ${aws.creds.sessionToken}
    DB_PASSWORD: ${db.password}
```

```bash
pulumi env run prod -- terraform plan
pulumi env run prod -- kubectl apply -f manifests/
```

---

## Unit Testing

```typescript
// __tests__/vpc.test.ts
import * as pulumi from "@pulumi/pulumi";
import "jest";

// Mock Pulumi runtime for unit testing
pulumi.runtime.setMocks({
  newResource: (args) => ({ id: `${args.name}-id`, state: args.inputs }),
  call: (args) => ({ outputs: {} }),
});

describe("VPC", () => {
  let infra: typeof import("../index");

  beforeAll(async () => {
    infra = await import("../index");
  });

  test("VPC has correct CIDR", async () => {
    const cidr = await infra.vpc.cidrBlock;
    expect(cidr).toBe("10.0.0.0/16");
  });

  test("DNS hostnames enabled", async () => {
    const enabled = await infra.vpc.enableDnsHostnames;
    expect(enabled).toBe(true);
  });
});
```

---

## CI/CD with GitHub Actions

```yaml
name: Pulumi

on:
  pull_request:
  push:
    branches: [main]

jobs:
  pulumi:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActionsRole
          aws-region: us-east-1

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      - uses: pulumi/actions@v5
        with:
          command: ${{ github.event_name == 'push' && 'up' || 'preview' }}
          stack-name: org/my-infra/prod
        env:
          PULUMI_ACCESS_TOKEN: ${{ secrets.PULUMI_ACCESS_TOKEN }}
```
