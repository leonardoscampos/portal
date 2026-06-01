---
title: Docker
description: Autoria de Dockerfile, builds multi-estágio, BuildKit, Docker Compose, otimização de imagem e padrões de registro.
---

<div class="domain-page-hero" data-domain="containers">
  <div class="dph-left">
    <span class="dph-eyebrow">// containers-orchestration / docker</span>
    <h1 class="dph-title">Docker</h1>
    <p class="dph-desc">O padrão para construção e entrega de containers. Imagens enxutas e reproduzíveis com builds multi-estágio e BuildKit, ambientes de desenvolvimento portáteis com Compose e uma abordagem orientada à segurança para autoria de Dockerfile e gerenciamento de registro.</p>
    <div class="dph-badges">
      <span class="tech-badge">Dockerfile</span>
      <span class="tech-badge">Multi-stage</span>
      <span class="tech-badge">BuildKit</span>
      <span class="tech-badge">Compose</span>
      <span class="tech-badge">Registry</span>
      <span class="tech-badge">Otimização</span>
    </div>
  </div>
</div>

[← Visão Geral de Containers](index.md) | [Kubernetes →](kubernetes.md)

---

## Boas Práticas com Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
# ─── Stage 1: Build ─────────────────────────────────
FROM golang:1.22-alpine AS builder

# Install only what's needed for the build
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /src

# Layer cache: copy dependency files first
COPY go.mod go.sum ./
RUN go mod download

# Then copy source (invalidates cache only on code changes)
COPY . .

# Build a fully static binary
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-w -s" \
      -o /app/server \
      ./cmd/server

# ─── Stage 2: Runtime ───────────────────────────────
FROM scratch

# Minimal runtime: copy certs and timezone data from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /app/server /server

# Run as non-root
USER 65532:65532

EXPOSE 8080

ENTRYPOINT ["/server"]
```

---

## Padrões de Build Multi-estágio

=== "Node.js"

    ```dockerfile
    # syntax=docker/dockerfile:1
    FROM node:20-alpine AS deps
    WORKDIR /app
    COPY package.json package-lock.json ./
    RUN npm ci --omit=dev

    FROM node:20-alpine AS builder
    WORKDIR /app
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    RUN npm run build

    FROM node:20-alpine AS runner
    WORKDIR /app
    ENV NODE_ENV=production
    RUN addgroup -S app && adduser -S app -G app
    COPY --from=builder /app/.next ./.next
    COPY --from=builder /app/public ./public
    COPY --from=deps /app/node_modules ./node_modules
    COPY package.json ./
    USER app
    EXPOSE 3000
    CMD ["node", "server.js"]
    ```

=== "Python"

    ```dockerfile
    # syntax=docker/dockerfile:1
    FROM python:3.12-slim AS builder

    RUN apt-get update && apt-get install -y --no-install-recommends gcc \
        && rm -rf /var/lib/apt/lists/*

    WORKDIR /app
    COPY requirements.txt .

    # Install into a prefix for easy copy
    RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

    FROM python:3.12-slim AS runtime
    WORKDIR /app

    COPY --from=builder /install /usr/local
    COPY . .

    RUN useradd -m -u 1001 appuser
    USER appuser

    EXPOSE 8000
    CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
    ```

=== "Java (JVM)"

    ```dockerfile
    # syntax=docker/dockerfile:1
    FROM eclipse-temurin:21-jdk AS builder
    WORKDIR /app
    COPY .mvn/ .mvn/
    COPY mvnw pom.xml ./
    RUN ./mvnw dependency:go-offline -q

    COPY src ./src
    RUN ./mvnw package -DskipTests -q

    # Extract Spring Boot layers
    RUN java -Djarmode=layertools -jar target/*.jar extract

    FROM eclipse-temurin:21-jre-jammy AS runtime
    WORKDIR /app
    RUN adduser --system --group spring
    USER spring:spring

    COPY --from=builder /app/dependencies/ ./
    COPY --from=builder /app/spring-boot-loader/ ./
    COPY --from=builder /app/snapshot-dependencies/ ./
    COPY --from=builder /app/application/ ./

    EXPOSE 8080
    ENTRYPOINT ["java", "org.springframework.boot.loader.JarLauncher"]
    ```

---

## Recursos do BuildKit

```bash
# Enable BuildKit (default in Docker 23+)
export DOCKER_BUILDKIT=1

# Build with cache mount (speeds up package installs)
# --mount=type=cache preserves package manager cache between builds
```

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./

# Cache npm install across builds — never stored in the final layer
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npm run build
```

```bash
# Build with secret (not stored in image layers)
docker build \
  --secret id=npmrc,src=$HOME/.npmrc \
  -t my-app .
```

```dockerfile
# Consuming the secret inside the build
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci
```

```bash
# Multi-platform build
docker buildx create --use --name multi-platform
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/my-org/my-app:1.0.0 \
  --push .
```

---

## .dockerignore

```gitignore
# .dockerignore
.git
.gitignore
.github
**/*.md
docs/
tests/
**/__pycache__/
**/*.pyc
**/*.pyo
node_modules/
.npm
dist/
build/
*.log
.env
.env.*
!.env.example
*.test.ts
*.spec.ts
coverage/
.DS_Store
Thumbs.db
```

---

## Docker Compose

```yaml
# compose.yaml (Docker Compose v2 — preferred filename)
name: my-app

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime
      cache_from:
        - type=registry,ref=ghcr.io/my-org/my-app:cache
    image: ghcr.io/my-org/my-app:local
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/app
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 15s

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pg-data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - api

volumes:
  pg-data:
  redis-data:
```

```bash
# Common Compose commands
docker compose up -d                    # start in background
docker compose up --build               # rebuild images before starting
docker compose logs -f api              # tail logs for a service
docker compose exec api sh              # shell into running container
docker compose down -v                  # stop and remove volumes
docker compose ps                       # list containers
docker compose run --rm api python manage.py migrate  # one-off command
```

---

## Otimização de Imagem

| Técnica | Impacto |
|-----------|--------|
| **Builds multi-estágio** | Exclui ferramentas de build da imagem de execução |
| **Base `scratch` / distroless** | Superfície de ataque mínima e menor tamanho |
| **Base Alpine** | ~5 MB — bom equilíbrio entre tamanho e ferramental |
| **Ordenação de camadas** | Copie arquivos de dependência antes do código-fonte para eficiência do cache |
| **`--no-install-recommends`** | Reduz o inchaço de pacotes instalados pelo apt |
| **Encadeamento de comandos `RUN`** | Combine comandos relacionados para reduzir a contagem de camadas |
| **Mounts de cache BuildKit** | Evita o re-download de pacotes (`--mount=type=cache`) |
| **`.dockerignore`** | Mantém o contexto de build pequeno — exclua `node_modules`, `.git`, testes |
| **`-ldflags="-w -s"` (Go)** | Remove informações de debug — reduz o tamanho do binário ~30% |
| **`--slim` / Dive** | Analise camadas com a ferramenta `dive` para encontrar camadas pesadas |

```bash
# Analyse image layers
docker run --rm -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  wagoodman/dive:latest my-app:latest

# Check image size
docker images my-app --format "{{.Size}}"

# Inspect layer history
docker history --no-trunc my-app:latest
```

---

## Operações de Registro

```bash
# Tag and push
docker tag my-app:local ghcr.io/my-org/my-app:1.2.3
docker push ghcr.io/my-org/my-app:1.2.3
docker push ghcr.io/my-org/my-app:latest

# Login to different registries
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USER --password-stdin
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# Pull and retag
docker pull ghcr.io/my-org/my-app:1.2.3
docker tag ghcr.io/my-org/my-app:1.2.3 my-internal-registry/my-app:1.2.3

# Inspect remote manifest (without pulling)
docker manifest inspect ghcr.io/my-org/my-app:1.2.3

# Sign image with cosign
cosign sign --key cosign.key ghcr.io/my-org/my-app:1.2.3
cosign verify --key cosign.pub ghcr.io/my-org/my-app:1.2.3
```

---

## Redes Docker

```bash
# Create a custom bridge network
docker network create --driver bridge app-net

# Connect containers to a named network
docker run -d --name api --network app-net my-app
docker run -d --name db  --network app-net postgres:16

# Inspect network
docker network inspect app-net

# Port mapping
docker run -p 8080:80       # host:container
docker run -p 127.0.0.1:8080:80  # bind to localhost only (security)
```

---

## Hardening de Segurança

```dockerfile
# Prefer distroless or scratch for production
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

# Never run as root
USER nonroot:nonroot

# Read-only filesystem (enforce in pod spec too)
# docker run --read-only --tmpfs /tmp my-app

# Drop all capabilities (enforce in pod securityContext)
# docker run --cap-drop ALL --cap-add NET_BIND_SERVICE my-app

# No new privileges
# docker run --security-opt no-new-privileges my-app
```

```bash
# Scan image for vulnerabilities
trivy image ghcr.io/my-org/my-app:1.2.3

# Scan Dockerfile for misconfigurations
trivy config Dockerfile

# CIS benchmark check for Docker daemon
docker run --rm -it \
  --net host --pid host --userns host --cap-add audit_control \
  -v /var/lib:/var/lib \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker/docker-bench-security
```

---

## Cheatsheet do Docker CLI

```bash
# Build
docker build -t app:tag -f Dockerfile.prod .
docker buildx build --platform linux/amd64,linux/arm64 --push -t app:tag .

# Run
docker run -d --name app -p 8080:8080 --env-file .env app:tag
docker run --rm -it app:tag sh                   # interactive, auto-remove

# Inspect & Debug
docker logs -f --tail 100 app                    # stream logs
docker exec -it app sh                           # shell into running container
docker stats app                                 # live CPU/mem/net
docker inspect app                               # full metadata JSON
docker top app                                   # processes in container

# Lifecycle
docker stop app && docker rm app                 # graceful stop + remove
docker kill app                                  # SIGKILL
docker restart --time 10 app                     # 10s grace period

# Cleanup
docker system prune -af --volumes               # ⚠️ removes everything unused
docker image prune -a                           # dangling + unused images
docker volume prune                             # unused volumes

# Export / Import
docker save app:tag | gzip > app.tar.gz
docker load < app.tar.gz
docker export app | gzip > container.tar.gz     # running container → tarball
```

[← Visão Geral de Containers](index.md) | [Kubernetes →](kubernetes.md)
