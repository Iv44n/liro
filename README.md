# Liro

A decision automation platform built on Jev. Define a decision once and consume it from any system.

| Directory | What it is | Port |
|---|---|---|
| `api/` | Bun + Arcton + Better Auth (organizations, API keys) + Drizzle/Postgres | 3002 |
| `web/` | TanStack Start + shadcn/base-ui dashboard | 3003 |
| Postgres (`docker-compose.dev.yml`) | `liro_db` for development, `liro_test` for tests | 5434 |

## Development

```bash
docker compose -f docker-compose.dev.yml up -d postgres
cd api && bun install && bun run db:push && bun run dev
cd web && bun install && bun run dev
```

`api/.env` chooses the providers:

- **Evaluator** (`EVALUATOR_PROVIDER`):
  - `vercel-gateway`: Jev through Vercel AI Gateway. Needs `AI_GATEWAY_API_KEY`.
  - `typesafe`: TypeSafe's official API. Needs `TYPESAFE_API_KEY`; `JEV_MODEL_VERSION` (e.g. `1.13.0`) pins the default model, otherwise `jev-latest`.
  - `fake`: deterministic answers, no key needed.
  - `EVALUATOR_FALLBACK_PROVIDER` (optional, `vercel-gateway` or `typesafe`, needs its key): tried once when the primary is unavailable, overloaded or rate limited, except for versions pinned to a model version the fallback can't pin (the gateway). Not allowed with `fake`.
- **Email** (`EMAIL_PROVIDER`):
  - `resend`: sends real email.
  - `console`: logs emails, including verification links, to the terminal.
  - `memory`: keeps emails in memory; used by tests.

## Tests (`api/`)

```bash
bun run test:db       # creates/updates liro_test (once, and after schema changes)
bun run test          # unit + evaluator contract + integration
bun run test:coverage # same, with an 80% per-file threshold
bun run test:smoke    # real calls to Vercel AI Gateway (needs AI_GATEWAY_API_KEY)
```

The web tests use `vitest` (`cd web && bun run test`).
