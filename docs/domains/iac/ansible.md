---
title: Ansible
description: Ansible playbooks, roles, inventory, Vault, collections and AWX reference.
---

<div class="domain-page-hero" data-domain="iac">
  <div class="dph-left">
    <span class="dph-eyebrow">// infrastructure-as-code / ansible</span>
    <h1 class="dph-title">Ansible</h1>
    <p class="dph-desc">Agentless configuration management and application deployment over SSH. Ansible excels at OS-level configuration, software installation, patching and post-provision orchestration — a natural complement to Terraform.</p>
    <div class="dph-badges">
      <span class="tech-badge">Playbooks</span>
      <span class="tech-badge">Roles</span>
      <span class="tech-badge">Inventory</span>
      <span class="tech-badge">Vault</span>
      <span class="tech-badge">Collections</span>
      <span class="tech-badge">AWX</span>
    </div>
  </div>
</div>

[← Terraform](terraform.md) | [← IaC Overview](index.md) | [CloudFormation →](cloudformation.md)

---

## How Ansible Works

Ansible connects to target hosts over SSH (or WinRM for Windows), pushes temporary Python modules and cleans up — no persistent agent required.

```
Control Node  ──SSH──▶  Managed Nodes
  ansible.cfg              host1 (Ubuntu)
  inventory                host2 (RHEL)
  playbooks/               host3 (Amazon Linux)
  roles/
```

---

## Inventory

=== "Static INI"

    ```ini
    # inventory/hosts.ini
    [webservers]
    web1.prod.example.com
    web2.prod.example.com

    [dbservers]
    db1.prod.example.com ansible_user=dbadmin

    [prod:children]
    webservers
    dbservers

    [prod:vars]
    ansible_user=ec2-user
    ansible_ssh_private_key_file=~/.ssh/prod.pem
    ```

=== "Static YAML"

    ```yaml
    # inventory/hosts.yml
    all:
      children:
        webservers:
          hosts:
            web1.prod.example.com:
            web2.prod.example.com:
        dbservers:
          hosts:
            db1.prod.example.com:
              ansible_user: dbadmin
      vars:
        ansible_user: ec2-user
    ```

=== "Dynamic (AWS EC2)"

    ```yaml
    # inventory/aws_ec2.yml
    plugin: amazon.aws.aws_ec2
    regions:
      - us-east-1
      - us-west-2
    filters:
      tag:Environment: prod
      instance-state-name: running
    keyed_groups:
      - key: tags.Role
        prefix: role
      - key: placement.region
        prefix: region
    hostnames:
      - private-ip-address
    compose:
      ansible_host: private_ip_address
    ```

    ```bash
    ansible-inventory -i inventory/aws_ec2.yml --list
    ```

---

## Playbooks

```yaml
# playbooks/deploy-nginx.yml
---
- name: Configure web servers
  hosts: webservers
  become: true
  vars:
    nginx_version: "1.25.*"
    app_user: www-data

  pre_tasks:
    - name: Update apt cache
      ansible.builtin.apt:
        update_cache: true
        cache_valid_time: 3600

  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: "nginx={{ nginx_version }}"
        state: present

    - name: Deploy nginx config
      ansible.builtin.template:
        src: templates/nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload nginx

    - name: Ensure nginx is running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

---

## Roles

Roles are reusable, self-contained units with a standard directory layout.

```
roles/
└── nginx/
    ├── defaults/
    │   └── main.yml        # lowest-priority variables
    ├── vars/
    │   └── main.yml        # higher-priority variables
    ├── tasks/
    │   └── main.yml        # task list
    ├── handlers/
    │   └── main.yml        # event handlers
    ├── templates/
    │   └── nginx.conf.j2   # Jinja2 templates
    ├── files/
    │   └── ssl/            # static files
    ├── meta/
    │   └── main.yml        # role dependencies
    └── README.md
```

```yaml
# roles/nginx/tasks/main.yml
---
- name: Install nginx
  ansible.builtin.package:
    name: nginx
    state: present

- name: Deploy config
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  notify: Reload nginx

- name: Enable and start nginx
  ansible.builtin.service:
    name: nginx
    state: started
    enabled: true
```

Using a role in a playbook:

```yaml
- name: Configure web servers
  hosts: webservers
  become: true
  roles:
    - role: nginx
      vars:
        nginx_worker_processes: 4
    - role: certbot
```

---

## Ansible Vault

Encrypt sensitive data at rest in version control.

```bash
# Encrypt a new file
ansible-vault create group_vars/prod/secrets.yml

# Encrypt an existing file
ansible-vault encrypt group_vars/prod/secrets.yml

# Edit encrypted file in-place
ansible-vault edit group_vars/prod/secrets.yml

# View without decrypting to disk
ansible-vault view group_vars/prod/secrets.yml

# Decrypt a file
ansible-vault decrypt group_vars/prod/secrets.yml

# Encrypt a single string (embed in YAML)
ansible-vault encrypt_string 'SuperSecret123' --name db_password
```

```yaml
# group_vars/prod/secrets.yml  (encrypted)
db_password: !vault |
  $ANSIBLE_VAULT;1.1;AES256
  61396561623664336335...

# Run with vault password file
ansible-playbook site.yml --vault-password-file ~/.vault_pass
```

!!! tip "Use a vault password file in CI"
    Store the vault password as a CI secret, write it to a temp file at job start, and pass `--vault-password-file` to avoid prompts.

---

## Collections & Galaxy

Collections bundle roles, modules, plugins and playbooks into a distributable unit.

```yaml
# requirements.yml
collections:
  - name: amazon.aws
    version: ">=7.0"
  - name: community.general
    version: ">=8.0"
  - name: kubernetes.core
    version: ">=3.0"

roles:
  - name: geerlingguy.nginx
    version: "3.2.0"
```

```bash
ansible-galaxy collection install -r requirements.yml
ansible-galaxy role install -r requirements.yml
```

---

## ansible.cfg

```ini
[defaults]
inventory          = ./inventory
roles_path         = ./roles
collections_paths  = ./collections
remote_user        = ec2-user
private_key_file   = ~/.ssh/id_ed25519
host_key_checking  = False
retry_files_enabled = False
stdout_callback    = yaml
gathering          = smart
fact_caching       = jsonfile
fact_caching_connection = /tmp/ansible_facts
fact_caching_timeout = 3600

[privilege_escalation]
become       = True
become_method = sudo
become_user  = root

[ssh_connection]
pipelining   = True
ssh_args     = -o ControlMaster=auto -o ControlPersist=60s
```

---

## Common Modules Cheatsheet

| Module | Use Case |
|--------|----------|
| `ansible.builtin.apt` / `yum` / `package` | Install OS packages |
| `ansible.builtin.template` | Render Jinja2 template to file |
| `ansible.builtin.copy` | Copy static files to hosts |
| `ansible.builtin.file` | Manage file/dir permissions and state |
| `ansible.builtin.service` | Start/stop/enable systemd services |
| `ansible.builtin.user` | Create/manage OS users |
| `ansible.builtin.cron` | Manage crontab entries |
| `ansible.builtin.shell` / `command` | Run arbitrary commands |
| `ansible.builtin.get_url` | Download files from URLs |
| `ansible.builtin.lineinfile` | Idempotently edit single lines in files |
| `community.general.docker_container` | Manage Docker containers |
| `kubernetes.core.k8s` | Apply Kubernetes manifests |
| `amazon.aws.ec2_instance` | Manage EC2 instances |

---

## AWX / Ansible Automation Platform

AWX is the open-source web UI and API for running Ansible at scale.

| Concept | Description |
|---------|-------------|
| **Inventory** | Hosts/groups defined or synced from cloud sources |
| **Credential** | SSH keys, vault passwords, cloud tokens — stored encrypted |
| **Project** | Git repository containing playbooks |
| **Job Template** | Playbook + inventory + credential = runnable unit |
| **Workflow** | DAG of job templates with conditional branching |
| **Schedule** | Cron-based automatic job execution |
| **RBAC** | Teams, users and per-object permissions |

```yaml
# Deploy AWX with the AWX Operator on Kubernetes
apiVersion: awx.ansible.com/v1beta1
kind: AWX
metadata:
  name: awx-prod
  namespace: awx
spec:
  service_type: ClusterIP
  ingress_type: ingress
  hostname: awx.example.com
  postgres_storage_class: gp3
  postgres_storage_requirements:
    requests:
      storage: 20Gi
```
