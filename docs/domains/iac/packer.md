---
title: Packer
description: HashiCorp Packer para criação de imagens de máquina imutáveis em múltiplos provedores de nuvem — AMIs, imagens Azure, imagens GCE, Docker e mais.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / packer</span>
    <h1 class="dph-title">Packer</h1>
    <p class="dph-desc">HashiCorp Packer automatiza a criação de imagens de máquina idênticas em múltiplas plataformas a partir de uma única configuração de origem. Crie AMIs, imagens Azure, imagens GCE e contêineres Docker imutáveis — empacote sua aplicação, nunca configure após o lançamento.</p>
    <div class="dph-badges">
      <span class="tech-badge">HCL2</span>
      <span class="tech-badge">AMI</span>
      <span class="tech-badge">Azure Images</span>
      <span class="tech-badge">GCE Images</span>
      <span class="tech-badge">Provisioners</span>
      <span class="tech-badge">Post-Processors</span>
    </div>
  </div>
</div>

[← Visão Geral de IaC](index.md) | [Terraform →](terraform.md)

---

## Conceitos Principais

```
Source config (HCL2)
    │
    ▼
┌─────────────────────────────────────┐
│  Packer Build                       │
│  1. Launch temporary instance       │  ← Builder (AWS, Azure, GCP…)
│  2. Run provisioners                │  ← Shell, Ansible, Chef, Puppet
│  3. Create image snapshot           │  ← AMI / VHD / VMDK / tar
│  4. Terminate instance              │
│  5. Run post-processors             │  ← Compress, upload, manifest
└─────────────────────────────────────┘
    │
    ▼
Immutable golden image (versioned, tested, ready to deploy)
```

---

## Estrutura do Template (HCL2)

```hcl
# versions.pkr.hcl
packer {
  required_version = ">= 1.10.0"
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
    ansible = {
      source  = "github.com/hashicorp/ansible"
      version = "~> 1"
    }
  }
}
```

```hcl
# variables.pkr.hcl
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "source_ami_filter" {
  type    = string
  default = "al2023-ami-*-x86_64"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "app_version" {
  type    = string
  # passed at build time: -var 'app_version=1.2.3'
}
```

```hcl
# main.pkr.hcl
locals {
  timestamp = formatdate("YYYYMMDD-hhmm", timestamp())
  image_name = "my-app-${var.app_version}-${local.timestamp}"
}

source "amazon-ebs" "app" {
  region        = var.aws_region
  instance_type = var.instance_type

  source_ami_filter {
    filters = {
      name                = var.source_ami_filter
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners      = ["amazon"]
    most_recent = true
  }

  ami_name        = local.image_name
  ami_description = "My App ${var.app_version} — baked AMI"

  # Tag the AMI and its snapshots
  tags = {
    Name        = local.image_name
    App         = "my-app"
    Version     = var.app_version
    BuildDate   = local.timestamp
    ManagedBy   = "packer"
  }
  snapshot_tags = {
    App     = "my-app"
    Version = var.app_version
  }

  # Temporary instance config
  temporary_key_pair_type = "ed25519"
  ssh_username            = "ec2-user"

  launch_block_device_mappings {
    device_name           = "/dev/xvda"
    volume_size           = 20
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    delete_on_termination = true
    encrypted             = true
  }
}

build {
  name    = "my-app"
  sources = ["source.amazon-ebs.app"]

  # 1 — OS hardening
  provisioner "shell" {
    inline = [
      "sudo dnf update -y",
      "sudo dnf install -y aws-cli jq",
      "sudo systemctl enable amazon-ssm-agent",
    ]
  }

  # 2 — App install via Ansible
  provisioner "ansible" {
    playbook_file = "ansible/site.yml"
    extra_arguments = [
      "-e", "app_version=${var.app_version}",
      "--tags", "install,configure",
    ]
    ansible_env_vars = [
      "ANSIBLE_HOST_KEY_CHECKING=False",
      "ANSIBLE_STDOUT_CALLBACK=yaml",
    ]
  }

  # 3 — Validate the image
  provisioner "shell" {
    inline = [
      "my-app --version",
      "systemctl is-enabled my-app",
    ]
  }

  # 4 — Write manifest (AMI ID, region, digest)
  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
    custom_data = {
      app_version = var.app_version
    }
  }
}
```

---

## AMIs Multi-Região

```hcl
source "amazon-ebs" "app" {
  region = "us-east-1"  # build region

  # Copy to additional regions after build
  ami_regions = [
    "us-west-2",
    "eu-west-1",
    "ap-southeast-1",
  ]

  # Encrypt in every region
  ami_region_kms_key_ids = {
    "us-east-1"      = "arn:aws:kms:us-east-1:123456789012:key/mrk-us-east"
    "us-west-2"      = "arn:aws:kms:us-west-2:123456789012:key/mrk-us-west"
    "eu-west-1"      = "arn:aws:kms:eu-west-1:123456789012:key/mrk-eu"
    "ap-southeast-1" = "arn:aws:kms:ap-southeast-1:123456789012:key/mrk-ap"
  }

  encrypt_boot = true
}
```

---

## Builders Azure e GCP

=== "Azure"

    ```hcl
    source "azure-arm" "app" {
      use_azure_cli_auth = true

      resource_group_name          = "packer-rg"
      storage_account              = "packerstorage"
      capture_container_name       = "images"
      capture_name_prefix          = "my-app"

      # Or use Managed Image:
      managed_image_name                = local.image_name
      managed_image_resource_group_name = "images-rg"

      os_type         = "Linux"
      image_publisher = "Canonical"
      image_offer     = "0001-com-ubuntu-server-jammy"
      image_sku       = "22_04-lts-gen2"

      location = "East US"
      vm_size  = "Standard_D2s_v3"

      azure_tags = {
        App     = "my-app"
        Version = var.app_version
      }
    }

    build {
      sources = ["source.azure-arm.app"]

      provisioner "shell" {
        execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
        inline = [
          "apt-get update",
          "apt-get install -y nginx",
          "/usr/sbin/waagent -force -deprovision+user && export HISTSIZE=0",
        ]
      }
    }
    ```

=== "GCP"

    ```hcl
    source "googlecompute" "app" {
      project_id   = "my-project"
      source_image_family = "ubuntu-2204-lts"
      zone         = "us-east1-b"
      machine_type = "n2-standard-2"

      image_name        = local.image_name
      image_family      = "my-app"
      image_description = "My App ${var.app_version}"

      image_labels = {
        app     = "my-app"
        version = replace(var.app_version, ".", "-")
      }

      disk_size = 20
      disk_type = "pd-ssd"

      ssh_username = "packer"
      use_os_login = true

      # Use a dedicated service account
      impersonate_service_account = "packer@my-project.iam.gserviceaccount.com"
    }

    build {
      sources = ["source.googlecompute.app"]

      provisioner "shell" {
        scripts = [
          "scripts/setup.sh",
          "scripts/install-app.sh",
          "scripts/harden.sh",
        ]
      }
    }
    ```

---

## Build Multi-Plataforma (Paralelo)

```hcl
# Build AWS + Azure + GCP images simultaneously in one packer build
build {
  name = "multi-cloud-app"
  sources = [
    "source.amazon-ebs.app",
    "source.azure-arm.app",
    "source.googlecompute.app",
  ]

  # Provisioners apply to all sources unless 'only' is set
  provisioner "shell" {
    only   = ["amazon-ebs.app"]
    inline = ["sudo dnf update -y"]
  }

  provisioner "shell" {
    only   = ["azure-arm.app", "googlecompute.app"]
    inline = ["sudo apt-get update -y"]
  }

  provisioner "ansible" {
    playbook_file = "ansible/site.yml"
    # runs on ALL sources
  }
}
```

---

## Provisionadores

=== "Shell"

    ```hcl
    provisioner "shell" {
      # Inline commands
      inline = [
        "sudo dnf update -y",
        "sudo dnf install -y httpd",
      ]

      # Or external scripts
      scripts = [
        "scripts/00-base.sh",
        "scripts/01-app.sh",
        "scripts/99-cleanup.sh",
      ]

      # Environment variables for scripts
      environment_vars = [
        "APP_VERSION=${var.app_version}",
        "ENVIRONMENT=production",
      ]

      # Retry on transient failures (e.g. yum lock)
      max_retries = 3
      pause_before = "10s"
    }
    ```

=== "Ansible"

    ```hcl
    provisioner "ansible" {
      playbook_file   = "ansible/site.yml"
      roles_path      = "ansible/roles"
      galaxy_file     = "ansible/requirements.yml"
      galaxy_force_install = true

      extra_arguments = [
        "-e", "app_version=${var.app_version}",
        "--tags", "install",
        "--diff",
      ]

      ansible_env_vars = [
        "ANSIBLE_HOST_KEY_CHECKING=False",
        "ANSIBLE_CALLBACKS_ENABLED=profile_tasks",
      ]
    }
    ```

=== "File"

    ```hcl
    # Upload config files before shell runs
    provisioner "file" {
      source      = "configs/app.conf"
      destination = "/tmp/app.conf"
    }

    provisioner "shell" {
      inline = ["sudo mv /tmp/app.conf /etc/app/app.conf"]
    }
    ```

---

## Pós-processadores

```hcl
build {
  sources = ["source.amazon-ebs.app"]

  # Write build output to JSON (AMI ID, region, etc.)
  post-processor "manifest" {
    output     = "manifest.json"
    strip_path = true
    custom_data = {
      app_version = var.app_version
      git_sha     = "${env("GIT_SHA")}"
    }
  }

  # Checksum the artifact
  post-processor "checksum" {
    checksum_types = ["sha256"]
    output         = "packer_{{.BuildName}}_{{.ChecksumType}}.checksum"
  }
}
```

```bash
# Read AMI ID from manifest after build
AMI_ID=$(jq -r '.builds[-1].artifact_id' manifest.json | cut -d: -f2)
echo "New AMI: $AMI_ID"

# Feed into Terraform
terraform apply -var="ami_id=$AMI_ID"
```

---

## Integração com CI/CD

```yaml
# GitHub Actions — build and share AMI ID across jobs
name: Build AMI

on:
  push:
    branches: [main]
    paths: ["packer/**", "ansible/**"]

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    outputs:
      ami-id: ${{ steps.ami.outputs.id }}

    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/PackerRole
          aws-region: us-east-1

      - uses: hashicorp/setup-packer@main
        with:
          version: "1.11.x"

      - name: Init plugins
        run: packer init packer/

      - name: Validate template
        run: packer validate -var "app_version=${{ github.ref_name }}" packer/

      - name: Build AMI
        run: |
          packer build \
            -var "app_version=${{ github.ref_name }}" \
            packer/
        env:
          PACKER_LOG: 1

      - name: Export AMI ID
        id: ami
        run: |
          AMI_ID=$(jq -r '.builds[-1].artifact_id' manifest.json | cut -d: -f2)
          echo "id=$AMI_ID" >> "$GITHUB_OUTPUT"

  deploy:
    needs: build
    uses: ./.github/workflows/deploy.yml
    with:
      ami-id: ${{ needs.build.outputs.ami-id }}
```

---

## Comandos CLI Úteis

```bash
# Initialise plugins
packer init .

# Validate template (no build)
packer validate -var 'app_version=1.2.3' .

# Format HCL files
packer fmt .

# Build (verbose logging)
PACKER_LOG=1 packer build -var 'app_version=1.2.3' .

# Build only specific source
packer build -only 'amazon-ebs.app' .

# Build except a source
packer build -except 'googlecompute.app' .

# Inspect template (list sources/provisioners)
packer inspect .

# Show installed plugins
packer plugins installed

# Clean plugin cache
packer plugins remove github.com/hashicorp/amazon
```

---

## Política IAM (AWS)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PackerEC2",
      "Effect": "Allow",
      "Action": [
        "ec2:AttachVolume", "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CopyImage", "ec2:CreateImage", "ec2:CreateKeyPair",
        "ec2:CreateSecurityGroup", "ec2:CreateSnapshot",
        "ec2:CreateTags", "ec2:CreateVolume",
        "ec2:DeleteKeyPair", "ec2:DeleteSecurityGroup",
        "ec2:DeleteSnapshot", "ec2:DeleteVolume",
        "ec2:DeregisterImage", "ec2:DescribeImageAttribute",
        "ec2:DescribeImages", "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus", "ec2:DescribeRegions",
        "ec2:DescribeSecurityGroups", "ec2:DescribeSnapshots",
        "ec2:DescribeSubnets", "ec2:DescribeTags",
        "ec2:DescribeVolumes", "ec2:DescribeVpcs",
        "ec2:DetachVolume", "ec2:GetPasswordData",
        "ec2:ModifyImageAttribute", "ec2:ModifyInstanceAttribute",
        "ec2:ModifySnapshotAttribute", "ec2:RegisterImage",
        "ec2:RunInstances", "ec2:StopInstances",
        "ec2:TerminateInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

[← Visão Geral de IaC](index.md) | [Terraform →](terraform.md)
