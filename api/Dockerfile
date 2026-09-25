# ========== BASE ==========
FROM oven/bun:1-alpine AS base

WORKDIR /app

# ========== DEPS ==========
FROM base AS deps

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

# ========== BUILDER ==========
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN bun run compile

# ========== RUNTIME ==========
FROM alpine:3.22 AS runner

RUN apk add --no-cache libstdc++ libgcc ca-certificates

ENV ENVIRONMENT=production

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /app/arcton-app ./arcton-app

USER app

EXPOSE 3000

CMD ["./arcton-app"]
