# MKWW MCP Server

Early-stage brainstem service for the MKWorldWide ecosystem. Handles idea ingestion,
planning, routing, and integration dispatching.

## Requirements
- PostgreSQL (configure `POSTGRES_URL`)
- Redis instance for BullMQ queues (`REDIS_URL`)

## Core Endpoints
- `POST /ideas` → store idea, enqueue plan and route steps.
- `POST /tasks` → enqueue a specific action.
- `GET /runs/:id` → status/logs for a run.
- `POST /integrations/github/dispatch` → `{ repo, event_type, client_payload? }`
- `POST /integrations/discord/post` → `{ channelId|webhook, content|embeds }`
- `POST /integrations/render/deploy` → `{ service: 'serafina'|'lilybear'|... }`
- `POST /integrations/vrc/osc` → `{ address, value }`

## Development
```bash
npm install
cp .env.example .env
npm run dev
```

### Security
- All endpoints except `/health` and `/webhooks/github` require a JWT `Authorization` header.
- GitHub webhooks must include a valid `X-Hub-Signature-256` using `HMAC_GITHUB_SECRET`.
- Basic rate limiting (60 req/min) is enabled globally.

### Queue Worker
Task execution is handled asynchronously via BullMQ. The server process spawns a worker on startup to process queued steps.
