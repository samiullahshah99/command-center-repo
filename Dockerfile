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

# Copy manifests first so the install layer caches independently of source.
# .npmrc MUST be included: it sets shamefully-hoist=true. Without it the image
# gets pnpm's strict isolated node_modules while local dev gets a hoisted one,
# so imports resolve locally and fail in Docker. It also carries the Sentry
# module-resolution workaround.
COPY package.json pnpm-lock.yaml .npmrc ./

# No BuildKit cache mount here, deliberately.
#
# Railway's Metal builder requires cache mount ids to be literally prefixed with
# its own cache key -- `id=s/<service-id>-<target>` -- and forbids environment
# variables inside the id, so the service id would have to be hardcoded. That
# pins the Dockerfile to a single Railway service and breaks every other
# builder. A plain install is portable and costs only the download time.
#
# To re-enable caching for one specific Railway service, replace the RUN below
# with (service id from Railway -> service -> Settings):
#   RUN --mount=type=cache,id=s/<service-id>-/pnpm/store,target=/pnpm/store \
#       pnpm config set store-dir /pnpm/store --global \
#       && pnpm install --frozen-lockfile
RUN pnpm install --frozen-lockfile

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

# Sentry.
#
# Default is 'false' (enabled). It used to default to 'true', which silently
# shipped every production image with Sentry switched off — no events captured
# at all, not merely unresolved stack traces. An ARG default cannot be
# overridden by a runtime variable, so this must be correct here.
ARG NEXT_PUBLIC_SENTRY_DISABLED=false

# Inlined into the client bundle at build time. Without it the browser SDK has
# no DSN and reports nothing, even when enabled above.
ARG NEXT_PUBLIC_SENTRY_DSN

# Optional overrides; next.config.ts falls back to lucky-fours/command-center.
ARG NEXT_PUBLIC_SENTRY_ORG
ARG NEXT_PUBLIC_SENTRY_PROJECT

# Required for source map upload. Locally this comes from
# .env.sentry-build-plugin, which is gitignored and therefore absent from the
# build context — so it has to be passed in here.
#
# This is a secret. It is an ARG rather than a BuildKit secret mount because
# Railway auto-supplies service variables as build args and does not expose
# --secret. Exposure is bounded: ARG values are readable via `docker history`
# on the stage that declares them, and this is the `builder` stage, which is
# discarded — only .next/standalone and .next/static cross into the runner, so
# the token is not present in the published image. It is deliberately NOT
# re-declared as ENV in the runner stage.
#
# When source maps are missing in production, check this first: next.config.ts
# sets sourcemaps.disable when SENTRY_AUTH_TOKEN is absent, so the build
# succeeds quietly with unresolved stack traces.
ARG SENTRY_AUTH_TOKEN

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
