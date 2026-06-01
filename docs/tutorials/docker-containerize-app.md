---
title: "Tutorial: Containerize e Execute uma Aplicação com Docker"
description: "Aprenda a criar um Dockerfile eficiente com build multi-estágio, construir imagens e orquestrar múltiplos serviços com Docker Compose."
---

# Containerize e Execute uma Aplicação com Docker

Você vai partir do zero — código de uma API Node.js simples — e chegar a um ambiente completo com container da aplicação, banco de dados PostgreSQL e boas práticas de segurança, tudo orquestrado com Docker Compose.

**Tempo estimado:** 45 minutos &nbsp;·&nbsp; **Nível:** Iniciante

---

## Pré-requisitos

- Docker 24+ instalado → [docs.docker.com/get-docker](https://docs.docker.com/get-docker/)
- Docker Compose v2+ (incluído no Docker Desktop)
- Conhecimento básico de terminal

> Node.js **não precisa estar instalado** na sua máquina — tudo roda dentro do container.

---

## 1. A Aplicação

Uma API de tarefas (to-do) em Node.js com Express e PostgreSQL.

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

app.listen(3000, () => console.log('API rodando na porta 3000'));
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

## 2. Dockerfile com Build Multi-estágio

O build multi-estágio separa a instalação de dependências do runtime, resultando em uma imagem final menor e sem ferramentas de build.

**`Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: Dependências ──────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copiar manifesto de dependências ANTES do código-fonte
# para aproveitar o cache de layers do Docker
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: Runtime ───────────────────────────────────────
FROM node:20-alpine AS runtime

# Criar usuário não-root dedicado
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copiar apenas node_modules do estágio anterior
COPY --from=deps --chown=app:app /app/node_modules ./node_modules

# Copiar código-fonte
COPY --chown=app:app src/ ./src/

# Rodar como não-root
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/todos || exit 1

CMD ["node", "src/index.js"]
```

---

## 3. .dockerignore

Impede que arquivos desnecessários sejam enviados para o build context, tornando o build mais rápido e seguro.

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

## 4. Build e Execução Básica

```bash
# Construir a imagem
docker build -t todo-app:latest .

# Verificar tamanho (deve ser ~150MB com node:alpine)
docker images todo-app

# Executar o container expondo a porta 3000
docker run --rm -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  todo-app:latest
```

---

## 5. Docker Compose — Stack Completa

Com Compose, você sobe a aplicação e o banco com um único comando, sem precisar gerenciar redes e volumes manualmente.

**`db/init.sql`**

```sql
CREATE TABLE IF NOT EXISTS todos (
  id    SERIAL PRIMARY KEY,
  title TEXT    NOT NULL,
  done  BOOLEAN NOT NULL DEFAULT false
);
```

**`.env`** ⚠️ Não versionar — adicione ao `.gitignore`

```bash
POSTGRES_PASSWORD=s3cr3t_local
GRAFANA_ADMIN_PASSWORD=admin
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

### Subir e testar

```bash
# Subir todos os serviços em background
docker compose up -d

# Acompanhar logs da API
docker compose logs -f api

# Testar a API
curl http://localhost:3000/todos

curl -X POST http://localhost:3000/todos \
     -H "Content-Type: application/json" \
     -d '{"title": "Aprender Docker"}'

# Verificar a inserção
curl http://localhost:3000/todos

# Parar e remover containers (volumes são preservados)
docker compose down

# Parar E remover volumes (cuidado: apaga dados do banco)
docker compose down -v
```

---

## 6. Inspecionar e Depurar

```bash
# Listar containers em execução
docker ps

# Ver logs de um container específico
docker compose logs -f api

# Abrir shell dentro do container da API
docker compose exec api sh

# Conectar ao banco de dentro do container
docker compose exec db psql -U postgres -d todos

# Monitorar uso de CPU/memória em tempo real
docker stats
```

---

## 7. Boas Práticas Aplicadas

| Prática | Aplicada | Detalhe |
|---|:---:|---|
| Build multi-estágio | ✅ | Separa dependências do runtime |
| Cache de layers otimizado | ✅ | `package.json` copiado antes do código |
| Usuário não-root | ✅ | `adduser app` + `USER app` |
| `.dockerignore` configurado | ✅ | Exclui `node_modules`, `.git`, segredos |
| `HEALTHCHECK` declarado | ✅ | Orquestrador sabe quando container está pronto |
| Secrets via variáveis de ambiente | ✅ | Sem credenciais hardcoded no `Dockerfile` |
| `depends_on` com health check | ✅ | API aguarda banco estar pronto |
| Dados persistidos em named volume | ✅ | Dados sobrevivem a `docker compose down` |

---

## Próximos Passos

- [Docker — Referência Completa](../domains/containers/docker.md)
- [Kubernetes — Orquestração em Escala](../domains/containers/kubernetes.md)
- [Container Security — Boas Práticas](../domains/containers/container-security.md)
