# ============================================
# Stage 1: Install dependencies and build
# ============================================
# Install + build happen in one stage on purpose. pnpm's node_modules is a tree
# of symlinks into node_modules/.pnpm; copying it between stages is fragile.
# Only the self-contained standalone output crosses into the runner.

ARG NODE_VERSION=22-slim

FROM node:${NODE_VERSION} AS builder

WORKDIR /app

# pnpm is resolved from the "packageManager" field in package.json
RUN corepack enable

# Copy manifests first so the install layer caches independently of source
COPY package.json pnpm-lock.yaml ./

# NOTE: the cache mount MUST carry an id. Some builders (Railway's Metal
# builder among them) reject `--mount=type=cache` without one:
#   "flag '--mount=type=cache,target=...' is missing an id argument"
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store --global \
    && pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=true

# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# must be build args — setting them only as runtime vars has no effect.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/auth/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/auth/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard/overview
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard/overview
ARG NEXT_PUBLIC_SENTRY_DISABLED=true

RUN pnpm run build

# ============================================
# Stage 2: Production runner
# ============================================

FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /app/public ./public

# .next must exist and be writable for the prerender cache
RUN mkdir .next && chown node:node .next

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

# server.js is produced by output:'standalone' and honours PORT/HOSTNAME
CMD ["node", "server.js"]
