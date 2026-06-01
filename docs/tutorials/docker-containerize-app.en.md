---
title: "Tutorial: Containerize and Run an Application with Docker"
description: "Learn to write an efficient multi-stage Dockerfile, build images, and orchestrate multiple services with Docker Compose."
---

# Containerize and Run an Application with Docker

Starting from scratch — a simple Node.js API — you'll build a full environment with an application container, PostgreSQL database, and security best practices, all orchestrated with Docker Compose.

**Estimated time:** 45 minutes &nbsp;·&nbsp; **Level:** Beginner

---

## Prerequisites

- Docker 24+ → [docs.docker.com/get-docker](https://docs.docker.com/get-docker/)
- Docker Compose v2+ (included in Docker Desktop)
- Basic terminal knowledge

> Node.js does **not need to be installed** on your machine — everything runs inside the container.

---

## 1. The Application

A to-do API in Node.js with Express and PostgreSQL.

```bash
mkdir todo-app && cd todo-app
mkdir src db
```

**`src/index.js`**

```js
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'todos',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

app.get('/todos', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM todos ORDER BY id');
  res.json(rows);
});

app.post('/todos', async (req, res) => {
  const { title } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO todos (title, done) VALUES ($1, false) RETURNING *',
    [title]
  );
  res.status(201).json(rows[0]);
});

app.listen(3000, () => console.log('API listening on port 3000'));
```

**`package.json`**

```json
{
  "name": "todo-app",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5"
  }
}
```

---

## 2. Multi-stage Dockerfile

Multi-stage builds separate dependency installation from the runtime image, producing a smaller and safer final image.

**`Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: Dependencies ──────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy dependency manifests BEFORE source code
# to take advantage of Docker's layer cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: Runtime ───────────────────────────────────────
FROM node:20-alpine AS runtime

# Create a dedicated non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy only node_modules from the previous stage
COPY --from=deps --chown=app:app /app/node_modules ./node_modules

# Copy source code
COPY --chown=app:app src/ ./src/

# Run as non-root
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/todos || exit 1

CMD ["node", "src/index.js"]
```

---

## 3. .dockerignore

Prevents unnecessary files from being sent to the build context, making builds faster and safer.

**`.dockerignore`**

```
node_modules
.git
.gitignore
*.md
*.log
.env
.env.*
coverage/
.nyc_output/
```

---

## 4. Basic Build and Run

```bash
# Build the image
docker build -t todo-app:latest .

# Check size (should be ~150MB with node:alpine)
docker images todo-app

# Run the container exposing port 3000
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  todo-app:latest
```

---

## 5. Docker Compose — Full Stack

With Compose you bring up the application and database with a single command, without manually managing networks and volumes.

**`db/init.sql`**

```sql
CREATE TABLE IF NOT EXISTS todos (
  id    SERIAL PRIMARY KEY,
  title TEXT    NOT NULL,
  done  BOOLEAN NOT NULL DEFAULT false
);
```

**`.env`** ⚠️ Do not commit — add to `.gitignore`

```bash
POSTGRES_PASSWORD=s3cr3t_local
```

**`docker-compose.yml`**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      DB_HOST:     db
      DB_PORT:     5432
      DB_NAME:     todos
      DB_USER:     postgres
      DB_PASSWORD: ${POSTGRES_PASSWORD}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB:       todos
      POSTGRES_USER:     postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout:  5s
      retries:  5

volumes:
  postgres_data:
```

### Start and test

```bash
# Start all services in the background
docker compose up -d

# Follow API logs
docker compose logs -f api

# Test the API
curl http://localhost:3000/todos

curl -X POST http://localhost:3000/todos \
     -H "Content-Type: application/json" \
     -d '{"title": "Learn Docker"}'

# Verify the insert
curl http://localhost:3000/todos

# Stop and remove containers (volumes are preserved)
docker compose down

# Stop AND remove volumes (warning: deletes database data)
docker compose down -v
```

---

## 6. Inspect and Debug

```bash
# List running containers
docker ps

# Follow logs for a specific service
docker compose logs -f api

# Open a shell inside the API container
docker compose exec api sh

# Connect to the database from inside its container
docker compose exec db psql -U postgres -d todos

# Monitor CPU/memory usage in real time
docker stats
```

---

## 7. Best Practices Applied

| Practice | Applied | Detail |
|---|:---:|---|
| Multi-stage build | ✅ | Separates dependencies from runtime |
| Optimised layer cache | ✅ | `package.json` copied before source code |
| Non-root user | ✅ | `adduser app` + `USER app` |
| `.dockerignore` configured | ✅ | Excludes `node_modules`, `.git`, secrets |
| `HEALTHCHECK` declared | ✅ | Orchestrator knows when container is ready |
| Secrets via env vars | ✅ | No credentials hardcoded in `Dockerfile` |
| `depends_on` with health check | ✅ | API waits for the database to be ready |
| Data persisted in named volume | ✅ | Data survives `docker compose down` |

---

## Next Steps

- [Docker — Full Reference](../domains/containers/docker.md)
- [Kubernetes — Orchestration at Scale](../domains/containers/kubernetes.md)
- [Container Security — Best Practices](../domains/containers/container-security.md)
