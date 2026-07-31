# CLAUDE.md

Internal operations portal for Lucky Fours, built on a Next.js 16 + shadcn/ui
dashboard starter.

**This file is the short list of invariants and gotchas** — things you cannot
infer by reading the code. For depth (full tech stack, theming internals, icon
catalogue, troubleshooting), see [AGENTS.md](./AGENTS.md). Do not duplicate
AGENTS.md content here; the two files drift the moment they overlap.

## Key References

- **[AGENTS.md](./AGENTS.md)** — Deep reference: tech stack, structure, code style, theming, icons, troubleshooting
- **[docs/forms.md](./docs/forms.md)** — Form system: TanStack Form + Zod, composable fields, multi-step, sheet/dialog forms
- **[docs/themes.md](./docs/themes.md)** — Theme system: OKLCH colors, adding themes, font config
- **[docs/clerk_setup.md](./docs/clerk_setup.md)** — Clerk auth setup
- **[docs/access-status.md](./docs/access-status.md)** — Integration credential status
- **docs/prd.md** — *Not yet committed.* Product requirements.

## Removed from this template

Clerk Organizations (multi-tenant workspaces/teams), Clerk Billing/subscriptions,
navigation RBAC (it was powered by org membership), and the Kanban, Chat,
Notifications, Forms-demo, React Query demo, and Icons pages. **Clerk auth is
still in use.** Do not reintroduce `useOrganization`, `<Protect>`, `has({ plan })`,
`PricingTable`, or `NavItem.access`.

---

## Architecture invariants

### Feature folder anatomy

`src/features/products/` is the canonical example. **New features replicate this
shape exactly.** Actual structure:

```
src/features/products/
├── api/
│   ├── types.ts        # Response shapes, filter types, mutation payloads
│   ├── service.ts      # Data access. THE ONLY FILE that changes when the backend changes
│   ├── queries.ts      # queryOptions() factories + the query-key factory
│   └── mutations.ts    # useMutation hooks + cache invalidation
├── components/
│   ├── product-listing.tsx      # Server component: prefetch + HydrationBoundary
│   ├── product-form.tsx
│   ├── product-view-page.tsx
│   └── product-tables/
│       ├── index.tsx            # 'use client' — useSuspenseQuery + useDataTable
│       ├── columns.tsx
│       ├── cell-action.tsx
│       └── options.tsx          # Filter option definitions
├── constants/
│   └── product-options.ts
└── schemas/
    └── product.ts               # Zod schemas
```

Route pages stay thin and live separately under
`src/app/dashboard/<route>/page.tsx` — they parse search params and render the
feature's listing component. See `src/app/dashboard/product/page.tsx`.

**The dependency direction is one-way:** `types.ts` → `service.ts` →
`queries.ts` → components. Components never import mock APIs directly.

### Zod schema location

Schemas live at `src/features/<feature>/schemas/<entity>.ts`. Verified:
`src/features/products/schemas/product.ts`,
`src/features/users/schemas/user.ts`.

When the database arrives, Zod schemas **mirror** the Drizzle table definitions
— they do not replace them. Drizzle owns the DB shape; Zod validates at the
boundary (forms, route handlers, external payloads).

### Route-handler placement

Handlers live at `src/app/api/<resource>/route.ts`, with per-item handlers at
`src/app/api/<resource>/[id]/route.ts`. Existing: `api/products`, `api/users`.

> **There is no settled data-fetching pattern yet.** Those handlers are
> scaffolding — they currently return mock data, and `service.ts` calls the
> mocks directly rather than going through them. `service.ts` documents three
> options (Server Actions + ORM, Route Handlers + ORM, BFF proxy) and the repo
> has committed to none.

**Proposed convention** (decide before Day 2 data work): given the PRD specifies
a Python/FastAPI backend, route handlers should be reserved for

1. **Inbound webhooks** — Slack events, Fireflies transcript-ready callbacks
2. **BFF proxying** — where the browser must not hold a backend token

and *not* used as the primary read path. Feature reads go through `service.ts`,
which calls either the backend API or Drizzle directly.

### Data fetching — the TanStack Query SSR pattern

Three parts, all required. This is the official TanStack pattern; do not
improvise around it.

**1. Server component prefetches** (`product-listing.tsx`):

```tsx
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { productsQueryOptions } from '../api/queries';

export default function ProductListingPage() {
  const filters = { page: searchParamsCache.get('page'), /* … */ };
  const queryClient = getQueryClient();

  void queryClient.prefetchQuery(productsQueryOptions(filters)); // note: void, not await

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductTable />
    </HydrationBoundary>
  );
}
```

**2. Client component consumes** (`product-tables/index.tsx`):

```tsx
'use client';
const { data } = useSuspenseQuery(productsQueryOptions(filters));
```

**3. Both sides build the same query key** from the same `queryOptions` factory
in `api/queries.ts`, using a key factory:

```ts
export const productKeys = {
  all: ['products'] as const,
  list: (filters: ProductFilters) => [...productKeys.all, 'list', filters] as const,
  detail: (id: number) => [...productKeys.all, 'detail', id] as const
};
```

**Gotchas that break hydration silently:**

- `void prefetchQuery(...)` — deliberately **not** awaited, so the server does
  not block. The pending promise is dehydrated and resolves on the client.
  That works only because `src/lib/query-client.ts` sets
  `shouldDehydrateQuery` to include `status === 'pending'`.
- **The server and client filter objects must be identical.** The server reads
  them via `searchParamsCache` (nuqs server) and the client via
  `useQueryStates` (nuqs client). If the two disagree — a different default, a
  missing key — the keys differ, hydration misses, and the client refetches
  with a visible flash. Sort must use `getSortingStateParser` on both sides.
- `getQueryClient()` returns a **fresh** client per server request and a
  **singleton** in the browser. Never hoist it to module scope in a server
  component.

### Data model & naming

From PRD §6:

- **snake_case** for all table and column names.
- **Singular** entity names: `person`, `role_profile`, `tracked_item`,
  `recurring_task`, `completion_event`, `raw_event`.

> **ClickUp is the system of record for tasks.** `tracked_item` holds a
> `clickup_task_id` reference and **must not duplicate ClickUp task data** —
> no mirrored title, status, assignee, or due date beyond what is needed for a
> join. Duplicating it guarantees drift, and there is no reconciliation story.
> If a view needs task detail, read it from ClickUp.

---

## Authentication (Clerk)

- **Single-org.** Clerk provides authentication only. Organizations and Billing
  are removed — never use `useOrganization()`, `orgId`, `<Protect>`, or
  `has({ plan })`.
- **Auth routes live at `/auth/sign-in` and `/auth/sign-up`**, not Clerk's
  default `/sign-in`. The `NEXT_PUBLIC_CLERK_SIGN_IN_URL` /
  `NEXT_PUBLIC_CLERK_SIGN_UP_URL` vars must stay set or Clerk redirects to
  routes that do not exist.
- **Sign-up is restricted** at the Clerk dashboard level (domain allowlist, or
  invitation-only). This is dashboard config, not code — it is not visible in
  this repo and cannot be verified by reading it.
- **Route protection is in `src/proxy.ts`** — Next.js 16's renamed middleware.
  It uses `clerkMiddleware` + `createRouteMatcher(['/dashboard(.*)'])`.

> ⚠️ `createRouteMatcher` is **deprecated** by Clerk and will be removed in the
> next major. Path matching can diverge from how Next.js actually routes,
> leaving protected resources reachable. **New protected routes should do
> resource-based checks** in the page/layout/route handler itself
> (`const { userId } = await auth(); if (!userId) redirect('/auth/sign-in');`)
> rather than relying on the matcher.

> ⚠️ The user dropdown in `src/components/nav-user.tsx` has **no working
> handlers** — including "Log out", which renders but does nothing. Wire
> Clerk's `signOut` before this ships to real users.

### Required env vars to boot

Copy `.env.example` to `.env.local`. Without the first two, every
`/dashboard/*` route returns 500 with `@clerk/backend: Missing publishableKey`.

| Variable                                          | Purpose                                       |
| ------------------------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`               | **Required.** `pk_test_` dev, `pk_live_` prod |
| `CLERK_SECRET_KEY`                                | **Required.** `sk_test_` dev, `sk_live_` prod |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                   | `/auth/sign-in`                               |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                   | `/auth/sign-up`                               |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard/overview`                         |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard/overview`                         |

**Do not use `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL`.**
Those names do not exist in `@clerk/nextjs` v7 (verified against 7.6.1) and are
silently ignored — the redirect appears broken with no error.

Env changes do not hot-reload; restart the dev server. `.env*` and `/.clerk/`
are gitignored and must stay that way.

---

## Search-engine indexing: blocked everywhere

This is an internal portal and must **never** be indexed. The block is enforced
in three places and **all three must be kept**:

1. **`next.config.ts`** — `async headers()` in `baseConfig` sets
   `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on `/:path*`.
   This is the only layer that covers non-HTML responses (API routes, assets).
2. **`src/app/robots.ts`** — generated route serving `User-Agent: * / Disallow: /`.
3. **`src/app/layout.tsx`** — `robots: { index: false, follow: false }` in the
   exported `metadata`.

> ⚠️ **Easy to lose in a refactor.** The `headers()` function sits inside
> `baseConfig`, which is then passed through `withSentryConfig` — anyone
> restructuring that file can drop it without any test failing. Nothing in the
> build catches its absence. If you touch `next.config.ts`, verify
> `curl -I localhost:3000 | grep -i x-robots-tag` still returns the header.
>
> Do **not** re-add `public/robots.txt`. A static file in `public/` silently
> takes precedence over `src/app/robots.ts`. The one that used to live there
> disallowed only four paths and implicitly allowed everything else.

These are crawler *requests*, not access control. Actual protection is Clerk on
`/dashboard/*` via `src/proxy.ts`.

---

## Error tracking (Sentry)

- **`withSentryConfig` must be applied exactly once** in `next.config.ts`. It
  was previously applied twice with conflicting options; nested plugin
  instances are unsupported and made behaviour depend on which wrapper won.
- **`NEXT_PUBLIC_SENTRY_DISABLED` is a string.** Only the literal `'true'`
  disables Sentry. A bare `!process.env.NEXT_PUBLIC_SENTRY_DISABLED` check
  treats the documented default of `"false"` as truthy and silently switches
  Sentry off. This bug existed in three separate files; use
  `!== 'true'` everywhere.
- **Init lives in `src/instrumentation.ts` (server/edge) and
  `src/instrumentation-client.ts` (browser).** There are no
  `sentry.*.config.ts` files — those were wizard leftovers that nothing
  imported.
- **`SENTRY_AUTH_TOKEN` is build-time only.** Locally it comes from
  `.env.sentry-build-plugin` (gitignored); in Docker it arrives as a build ARG.
  Without it the build still succeeds but stack traces stay minified.
- **Upload logs are hidden locally** by `silent: !process.env.CI`. To debug
  source maps, run `CI=1 pnpm build`.

---

## LLM access (OpenRouter)

- **All LLM traffic goes through OpenRouter**, not the Anthropic API directly.
  OpenAI-compatible schema at `https://openrouter.ai/api/v1`.
- **`OPENROUTER_API_KEY` is server-side only.** Never prefix it `NEXT_PUBLIC_` —
  that inlines the key into the client bundle and leaks it to every visitor.
- **Every LLM call must go through a single `src/lib/ai/client.ts` module.**
  No inline `fetch` to OpenRouter inside feature code. One module means one
  place for retries, timeouts, cost logging, and model-slug changes.
  *(Not written yet — Week 2 work.)*

### Model slugs

Verified against the live OpenRouter catalog. Slugs move; re-check with
`curl -s https://openrouter.ai/api/v1/models` before pinning new ones.

| Tier | Slug | $/M in | $/M out |
| --- | --- | --- | --- |
| Haiku | `anthropic/claude-haiku-4.5` | 1.00 | 5.00 |
| Sonnet | `anthropic/claude-sonnet-5` | 2.00 | 10.00 |
| Opus | `anthropic/claude-opus-5` | 5.00 | 25.00 |

A `:batch` variant exists for most slugs at ~50% cost with async delivery —
worth using for scheduled work (nightly role monitors, Control Tower recompute)
where latency does not matter.

---

## Week 1 learnings — read this before Week 2

Everything below cost time to discover. Each one **masquerades as something
else**, which is why the WHY matters more than the rule.

### The pipeline: verify → persist → enqueue → normalise

```
webhook  →  verify HMAC        401 on failure, before anything else
         →  persist raw_event  VERBATIM, before responding 2xx
         →  enqueue parse job  in the SAME transaction as the insert
         →  2xx
worker   →  normalise          raw_event → unified_event, + resolve identity
```

**Handlers never parse.** They verify, store the payload untouched, enqueue, and
answer. Every interpretation happens later, in a normaliser, against a row that
is already safely on disk.

> **Why:** a parser bug in the request path loses the event permanently — the
> sender got its 2xx and will never resend. With the payload stored verbatim, a
> parser bug is a re-run: fix the mapping, `pnpm renormalise --stale --commit`.

Insert and enqueue share ONE transaction via pg-boss's `fromDrizzle(tx, sql)`
adapter, so a job can never reference a row that was rolled back. **The enqueue
is gated on `inserted`, not on success** — a duplicate delivery queues nothing,
or every provider retry would redo the work.

### Idempotency (already built — verify, do not rebuild)

`raw_event_source_external_id_idx` is a **partial** UNIQUE index on
`(source, external_id) WHERE external_id IS NOT NULL`, and `ingestRawEvent`
inserts with `ON CONFLICT DO NOTHING`. That single statement — not a
select-then-insert — is what makes concurrent duplicate deliveries safe.

`unified_event` has the same protection on `(raw_event_id, source_seq)`, so
re-normalising **upserts**. It must never delete-and-reinsert: Week 2's
extraction pipeline will hold foreign keys to `unified_event.id`.

> ⚠️ **The gap, by design:** events with a NULL `external_id` are NOT
> deduplicated, because Postgres treats NULLs as distinct in a unique index.
> That covers setup test pings (deliberate — a constant id would make the second
> ping vanish), ClickUp `taskDeleted` (no `history_items`, so no id to key on),
> and off-contract payloads. A retried `taskDeleted` therefore creates a second
> row. Accepted: a duplicate is recoverable, a merged pair of distinct events is
> not.

### Fireflies: the docs are for a DEPRECATED webhook

`docs.fireflies.ai/graphql-api/webhooks` documents v1. The live v2 payload is
**snake_case** and differs on every field: `meeting_id` not `meetingId`, `event`
not `eventType`, no `clientReferenceId`, plus an undocumented millisecond
`timestamp`. Confirmed from `Fireflies-Webhook/2.0` deliveries.

- Real event value observed: **`meeting.transcribed`** (lowercase, dotted).
- **Real events ARE signed** with `x-hub-signature`. Their *setup test* pings are
  unsigned and are correctly rejected 401. A temporary bypass for those has been
  removed — do not reintroduce one; both its conditions were attacker-controlled
  on a public endpoint.
- Idempotency key is the composite **`event:meeting_id`**, not `meeting_id`
  alone: one meeting emits several events and keying on the meeting alone makes
  `ON CONFLICT DO NOTHING` swallow the second with no error anywhere.

> ⚠️ **`audio_url` and `video_url` are the only paid-gated fields**, and GraphQL
> fails the WHOLE operation for one unauthorised field. Requesting them returned
> "You need to be subscribed to a paid plan" for every fetch, which reads exactly
> like the whole API being unavailable. It is not. With those two removed,
> `sentences`, `speakers`, `summary`, `participants`, `host_email` and
> `transcript_url` all work on the current plan — **including other people's
> meetings within the workspace** (verified on three meetings hosted by another
> user). Do not add the media URLs back without re-checking the plan.

### Slack `users:read.email` — GRANTED (was the blocker)

Slack event envelopes carry a user id and nothing else, so resolving a Slack
account needs `users.info` / `users.list`, which return `profile.email` only with
the `users:read.email` scope.

✅ **The scope is granted** (verified after reinstall: 30 humans, 30 emails), so
Slack identities resolve automatically. New scopes do NOT apply to an existing
installation — a reinstall was required.

> ⚠️ **Keep the guard.** A missing scope is NOT an error: `users.list` returns
> HTTP 200, `ok: true`, and silently OMITS `profile.email` — measured at 30
> humans / 0 emails while it was absent. A backfill reports success and links
> nobody. Scopes are lost to token rotation and reinstalls, so
> `requireEmailScope()` and the `x-oauth-scopes` check stay in place.

### Rate limits: what each provider actually exposes

Measured, not assumed:

| Provider | Headroom headers | Signal |
| --- | --- | --- |
| ClickUp | ✅ `x-ratelimit-limit` / `-remaining` / `-reset` on every response | 100/min on our plan; `-reset` is epoch **SECONDS** |
| Slack | ❌ **none at all** | Only `Retry-After` on a 429 — i.e. after the fact. Per-METHOD tiers. Does return `x-oauth-scopes`. |
| Fireflies | ❌ none | Limit is per **DAY**, so a 429 matters far more |

`src/features/connectors/rate-limit.ts` logs ClickUp headroom per call and warns
below 20% or 10 remaining. It cannot do the same for Slack — writing one shared
"log the remaining quota" helper would silently log nothing for Slack while
looking like it worked.

### Permanent vs transient failures

Do **not** retry a plan or auth failure six times. `classifyTranscriptFetchError`
splits them, and a permanent one throws `PermanentJobError`, which the worker
turns into pg-boss's `deadletter` status on the **first** attempt.

| Permanent | Transient |
| --- | --- |
| plan / subscription (`paid_required`) | 429 rate limit |
| auth failure, 401/403 | 5xx |
| response shape changed | network error |
| non-429 4xx | "not found" **within** 30 min of the webhook |

> ⚠️ **"Transcript not found" is ambiguous** and is resolved by AGE, not by the
> message: Fireflies can announce a meeting before the transcript is queryable.
> Inside `FIREFLIES_NOT_FOUND_GRACE_MINUTES` (30) it is transient; older, it is
> permanent. 30 minutes clears the ~7-minute retry ladder while making a backfill
> of old rows fail fast instead of burning a per-day budget.

### Identity resolution order

1. **EXACT** — an existing `person_identity` row for `(source, external_id)`
2. **EMAIL** — case-insensitive match on `person.email`; creates the link so
   later events short-circuit at step 1
3. **UNRESOLVED** — persisted with a null `person_id`, never dropped

> ⚠️ **THREE SEPARATE CLERK INSTANCES** — Vision, UGC and Command Centre. Ids are
> not comparable between them and may collide. Identity is always the PAIR
> `(source, external_id)`.

> ⚠️ **Name matching is NEVER auto-applied**, at any confidence level. There is
> deliberately no `'name'` confidence tier. Two people can share a display name
> and a wrong auto-link silently attributes one person's work to another —
> nobody goes looking for that. Names may appear as an *unverified suggestion* in
> the admin UI requiring explicit confirmation, which lands as `'manual'`.

Vision's `editor_name` is display-only and mutable. `unified_event` stores
`person_identity_id`, so linking an identity later back-fills its whole history
in one UPDATE rather than a re-normalisation.

### Queue: pg-boss in the same Postgres

- Dedicated **`pgboss` schema**; drizzle-kit is scoped to `public` via
  `schemaFilter`, so it never touches those tables.
- pg-boss's own columns are **snake_case** (`created_on`, `retry_count`,
  `completed_on`) — unlike our camelCase Drizzle models. Raw SQL against
  `pgboss.job` must use them.
- Queue names use a **dot** separator (`parse.slack`); v12 rejects `:`.
- Workers run **in-process**, booted from `src/instrumentation.ts`, which Next
  runs once per process at boot, `nodejs` runtime only.
- `batchSize: 2` means `work()` receives an ARRAY, and by default one throw fails
  the whole batch. `perJobResults: true` plus a per-job try/catch keeps a poison
  event from taking its neighbour down.
- `getBoss()` must not cache a rejected promise — a single startup failure would
  otherwise 500 every enqueue for the life of the process.

### Fixtures: `api-*.json` are LIVE CAPTURES

Anything under `fixtures/*/api-*.json` came off a real API and **has contained
real names and work email addresses**. This repo is public. Scrub before
committing — a captured ClickUp response leaked a real work email once already.
`pnpm fireflies:fixture` scrubs, replaces AI summary prose with synthetic text,
and refuses to write a file that still contains a real name.

### ClickUp is transitional

Read `TASK_SOURCE_OF_RECORD` only via `src/config/env.ts`, never `process.env`
inline. ClickUp is the only source that carries the actor email inline
(`history_items[].user.email`), so it resolves automatically from events with no
backfill call. Its `user.id` is a JSON **number**; `external_id` is text
everywhere else.

## Connectors and webhooks

### Webhook handler pattern — mandatory for every new connector

Four rules. Each exists because breaking it fails in a way that looks like a
different problem.

1. **Verify the signature against the RAW request body.** Read `await req.text()`
   once, then `JSON.parse` it yourself. Never `req.json()` first — it consumes
   the stream, and re-serialising changes the bytes, so the HMAC fails in a way
   that is indistinguishable from a wrong secret. Every connector has a test
   proving a re-serialised body fails verification.
2. **Write to `raw_event` BEFORE responding 2xx.** Senders do **not** retry after
   a success — a 2xx means "delivered, discard". A write deferred past the
   response is lost permanently and silently on failure. Persist first and return
   **500** on failure so the sender retries and idempotency absorbs the duplicate.
3. **Idempotent on the sender's own event id**, via the `(source, external_id)`
   partial unique index and `ON CONFLICT DO NOTHING`.
4. **`timingSafeEqual` behind a length guard** — it throws on length mismatch.

### The FIVE inbound signature schemes

Full reference: [docs/webhook-contract.md](./docs/webhook-contract.md).

| Source | Header | Prefix | Basestring | Replay window |
| --- | --- | --- | --- | --- |
| Slack | `X-Slack-Signature` | `v0=` | `v0:{ts}:{body}` | ✅ ±300s |
| UGC | `X-LuckyFours-Signature` | `sha256=` | `{ts}.{body}` | ✅ ±300s |
| Vision | `X-Vision-Signature` | `sha256=` | `{body}` | ❌ none |
| ClickUp | `X-Signature` | *(none)* | `{body}` | ❌ none |
| Fireflies | `X-Hub-Signature` | `sha256=` | `{body}` | ❌ none |

`src/features/connectors/verify-hmac.ts` exposes **two** functions —
`verifyWithTimestamp()` and `verifyBodyOnly()` — rather than one with an optional
timestamp. A security control must not be silently disabled by omitting a config
field; two functions make the absence visible at the call site.

> ⚠️ **UGC's separator is a literal DOT.** `{ts}.{body}`, not Slack's
> `v0:{ts}:{body}`. Copying the Slack verifier yields a valid-looking hex
> signature that never matches, reading exactly like a wrong secret.

> ⚠️ **UGC and Vision use DIFFERENT keys for the event type** — UGC sends
> `type`, Vision sends `event`. Both also send it as a header, which the handler
> prefers. Their envelopes differ elsewhere too (`actor.id` vs `actor.user_id`,
> `entity` vs `subject`); see docs/webhook-contract.md.

> ⚠️ **Fireflies is `x-hub-signature` with NO `-256` suffix.** GitHub's
> convention is `x-hub-signature-256` and most examples online show that form.
> Reading the wrong header means every request 401s as "missing signature
> header" — which looks like the sender not signing at all, rather than us
> reading the wrong key.

> ⚠️⚠️ **Vision, ClickUp and Fireflies have NO replay protection.** None of the
> three sends a timestamp, so a captured request stays valid forever and can be
> replayed verbatim. **Idempotency is the sole defence on those three.** Do not
> add side effects to those paths that are unsafe to repeat.
>
> Fireflies' v2 body *does* carry a millisecond `timestamp`, and because the
> signature covers the body an attacker cannot alter it — so it could bound
> replay. It deliberately does not: the payoff of a replay is an idempotent
> re-fetch, while a wrong window permanently drops a delayed retry from a sender
> whose retry behaviour is undocumented.

### Setup test events use constant ids

UGC sends `test.ping` with id `evt_test`; Vision sends `control_center.test` with
an all-zero id. Deduplicating on a constant id would make the *second* ping
vanish — during setup that looks exactly like a broken handler. Both are stored
with a **null** `external_id` so every ping lands, and logged as `TEST EVENT`.

### Fireflies: the published docs describe a DEPRECATED webhook

**`https://docs.fireflies.ai/graphql-api/webhooks` is not to be trusted.** It
documents the v1 (Developer Settings) webhook. Fireflies has replaced it with a
v2 system configured on the **Integrations page**, and the v2 payload differs on
*every* field. Confirmed from live deliveries sent by `Fireflies-Webhook/2.0`:

```json
{ "event": "test", "timestamp": 1785510895435, "meeting_id": "test_00000000" }
```

| v1 — docs, deprecated | v2 — actual |
| --- | --- |
| `meetingId` | `meeting_id` — **snake_case** |
| `eventType` | `event` |
| `clientReferenceId` | *does not exist* |
| *not mentioned* | `timestamp` — epoch **milliseconds** |

The handler was built against v1 and silently mis-parsed everything: three
stored rows all had a null `external_id` and `processed=false`, because
`externalIdOf` read `meetingId` and the worker rejected the envelope. The schema
now targets v2 only — the v1 shape is deliberately **not** accepted, so a future
shape change fails loudly instead of looking healthy.

- **Idempotency key is the composite `event:meeting_id`**, not `meeting_id`
  alone. One meeting can emit several events (transcribed, then summarized);
  keying on the meeting alone files the second under the first's key and
  `ON CONFLICT DO NOTHING` swallows it with no error anywhere. Both halves come
  from the body, so a `raw_event` replay can reconstruct the key — the
  `x-webhook-delivery-id` header cannot.
- **Test deliveries arrive UNSIGNED, but real events ARE signed** with
  `x-hub-signature` — confirmed by a live delivery that passed verification. The
  unsigned setup pings are rejected 401 like anything else unsigned. A temporary
  bypass that accepted them has been removed; **do not reintroduce it** — both of
  its conditions were attacker-controlled on a public endpoint.
- **Real event value is `meeting.transcribed`** — lowercase, dot-separated, not
  the title-case guess the fixtures originally carried.
- **Errors from the transcript fetch are classified permanent vs transient**
  (`classifyTranscriptFetchError`). Permanent ones — a paid-plan or auth failure,
  a changed response shape, a non-429 4xx — throw `PermanentJobError`, which the
  worker loop turns into pg-boss's `status: 'deadletter'` so the job skips its
  remaining retries. That matters because the API allows **500 requests per DAY**
  and the ladder spends four per meeting.
  > ⚠️ **`audio_url` and `video_url` are the ONLY paid-gated fields** — and
  > because GraphQL fails the whole operation for one unauthorised field,
  > requesting them made every fetch return "You need to be subscribed to a paid
  > plan", which reads exactly like the entire API being unavailable. It is not.
  > Probed field by field, `sentences`, `speakers`, `summary`, `participants`,
  > `host_email` and `transcript_url` all work on the current plan. Both media
  > URLs are excluded from `TRANSCRIPT_FIELDS`; **do not add them back** without
  > re-checking the plan.
- **"Transcript not found" is ambiguous** and is resolved by age, not by the
  message: within `FIREFLIES_NOT_FOUND_GRACE_MINUTES` (default 30) of the webhook
  it is transient (Fireflies can announce a meeting before the transcript is
  queryable); older than that it is permanent. 30 minutes sits clear of the ~7
  minute retry ladder so it cannot cut a live wait short, while making a backfill
  of old rows fail fast instead of burning quota.
- **The test `meeting_id` is the constant `test_00000000`**, so it is stored with
  a null `external_id` and the worker short-circuits it — same treatment as UGC
  and Vision. Fetching it would burn 4 calls from a 500-per-DAY budget and
  dead-letter.
- **There is no timestamp HEADER**, so nothing enters the signature basestring
  and `verifyBodyOnly` is correct. The *body* timestamp could bound replay, and
  deliberately is not used to: a successful replay only re-triggers an
  idempotent transcript fetch, whereas a wrong window permanently drops a
  delayed retry from a sender whose retry behaviour is undocumented.

### Data flow

- **`raw_event` is a landing zone.** Connectors store; they do **not** parse.
  Payloads are written verbatim so a parser bug is replayable — flip `processed`
  back to false and re-run, rather than having lost the event.
- **`ingestRawEvent()` in `src/features/connectors/ingest.ts` is the ONLY write
  path into `raw_event`.** No connector touches the table directly. That is what
  keeps the idempotency guarantee and the verbatim rule in one place instead of
  duplicated per connector.
- **Parsing `raw_event` into domain tables is a separate, later stage.** Nothing
  in the request path interprets meaning.

> `ingest.ts` is deliberately **not** `'use server'`. That would publish it as a
> Server Action, giving any browser an endpoint to inject rows into `raw_event`.

### ClickUp is TRANSITIONAL

- Per the lead, ClickUp is **temporary**, for content team outputs. In-platform
  brief creation plus studio stats APIs will replace it. PRD §3.2 still keeps it
  as system of record and §5.1 requires meeting action items to sync into it, so
  both have to work at once.
- **Do not build deeper ClickUp coupling.** The client is a thin typed wrapper;
  person→ClickUp user mapping, list selection, and status taxonomy mapping are
  deliberately absent and TODO-marked.
- **`TASK_SOURCE_OF_RECORD` controls behaviour — read it only via
  `src/config/env.ts`.** Never `process.env` it inline.
- **`tracked_item.source_system`** discriminates, and a CHECK constraint
  (`tracked_item_content_by_source_ck`) prevents `clickup`-sourced rows from
  holding `title`/`description`. Content columns are for `source_system='internal'`
  only. The rule is structural, not a comment — verified by inserting a clickup
  row with a title and watching Postgres reject it.

### Store everything, filter at the parsing stage

No handler filters on payload content. Vision sends an `environment` field
(`production` | `preview` | `development`) and **all of it is stored** —
production-only filtering happens later, at the parsing stage, not at ingest.

Both internal contracts state event types are **additive**, so unknown types must
be tolerated rather than rejected. The handlers never inspect event type except to
recognise setup test events.

The reasoning is the same as the Slack channel decision: an event never stored
cannot be replayed, while a wrong downstream filter is one WHERE clause away from
being fixed.

### Slack specifics

- **Event subscriptions are workspace-wide.** Channel scoping happens by **bot
  invitation**, not by config or code.
- **Do not add channel-prefix filtering.** Persist everything and filter
  downstream on `payload->>'channel'`. An event never stored cannot be replayed;
  a wrong downstream filter is one WHERE clause away from being fixed. There is a
  test asserting an unrelated channel is still persisted.

### Shopify is NOT integrated — internal backend endpoints replace it

PRD §5.5 and §7 list "Shopify | Read | Context for the copilot and status
queries (orders, inventory)". **That is served by internal backend endpoints, not
by the Shopify Admin API.** Per the team lead, direct Shopify access is out.

- **Do not build a Shopify client.** Shopify credentials are not being requested,
  and `SHOPIFY_*` variables must not reappear in `.env.example`.
- The typed interface lives at `src/features/connectors/backend/client.ts`.
  **Every method throws `NotImplementedError`** — the endpoints do not exist yet
  (awaiting the backend engineer).
- It is a **point-lookup** client, not a bulk sync: order by number, inventory by
  SKU, orders by customer name. The copilot answers ad-hoc questions at request
  time, so orders and inventory are never mirrored locally.
- `BACKEND_API_URL` / `BACKEND_API_TOKEN` are reserved in `.env.example`, but the
  auth scheme is unconfirmed — every connector so far has used a different one.

> The stub throws rather than returning plausible data on purpose. A stub that
> compiles and is wrong survives review; one that throws cannot be mistaken for
> a working integration. Open questions for the backend engineer are listed at
> the bottom of that file — resolve them before implementing.

The same reasoning applies to `src/features/connectors/studio/client.ts`.

### Fixtures

- **`fixtures/*/api-*.json` are captured from live APIs and have contained real
  names and email addresses.** Scrub PII before any commit — this repo is public.
  The captured ClickUp task response contained a real work email on first capture.
- Fixtures without the `api-` prefix are hand-written webhook envelopes and carry
  no real data.

### Auth conventions

A wrong header returns a 401 that is indistinguishable from a revoked token, so
each convention is encoded once in its own connector and never hand-written.

| Provider | Header |
| --- | --- |
| Slack | `Authorization: Bearer xoxb-...` |
| **ClickUp** | `Authorization: <token>` — **raw, NO `Bearer` prefix** |
| Notion | `Authorization: Bearer ...` **plus** the mandatory `Notion-Version` header |
| Fireflies | `Authorization: Bearer ...`, GraphQL only |

Each `authHeaders()` **throws** on a missing env var rather than sending
`Bearer undefined`, which produces the same ambiguous 401.

## Notion (PRD §5.8 — later phase)

Source for the company AI search feature. **Not on this week's critical path** —
the PRD marks §5.8 as possibly phased separately.

- Base URL `https://api.notion.com/v1`, `Authorization: Bearer <token>`.
- **`Notion-Version` is mandatory on every request** (currently `2022-06-28`).
  Omitting it returns `400 validation_error` — there is no default version.
- **PULL-ONLY.** Notion has no webhook API for internal integrations, so it does
  **not** fit the `raw_event` inbound-webhook pattern the other connectors use.
  It has to be polled or fetched on demand, which is a different shape — do not
  assume the Slack/Fireflies design transfers.
- **Deny-by-default per page.** An integration sees nothing until a page or
  database is explicitly shared with it (⋯ → Connections → Command Center).
  Sharing a *parent* page cascades to its children.
  > A `404 object_not_found` here almost always means "not shared", **not**
  > "wrong ID". Chasing the ID is the standard wasted hour.
- **Rate limit ≈ 3 requests/second** average. Bursts get `429`.
- **Cursor pagination on every list endpoint** — `has_more` / `next_cursor`.
  Reading only the first page silently under-reports.

Verify the credential and list shared databases with `pnpm verify:notion`
(`scripts/verify-notion.ts`). That script is read-only and is not the client.

The client will live at `src/features/connectors/notion/` **once the shared
connector interface exists** (Day 3). It is deliberately not written yet.

## Commands

Package manager is **pnpm** (pinned via `packageManager` in `package.json`).
Ignore any `bun run` references still in AGENTS.md.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | oxlint |
| `pnpm lint:fix` | oxlint --fix + format |
| `pnpm lint:strict` | Zero-warning gate |
| `pnpm format` | oxfmt |
| `pnpm format:check` | Verify formatting |
| `CI=1 pnpm build` | Build with Sentry source-map upload logs visible |

### Database commands

| Command | Purpose |
| --- | --- |
| `pnpm db:generate` | Emit a migration from schema changes into `drizzle/` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:push` | Push schema without a migration file — **dev only, never production** |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | ⚠️ Scripted but `src/db/seed.ts` does not exist yet |

---

## Database (Drizzle + Postgres)

Postgres 18 on Railway. Drizzle ORM with the `node-postgres` driver.

**Two URLs, on purpose:**

| Variable | Used by | Should point at |
| --- | --- | --- |
| `DATABASE_URL` | the running app (`src/db/index.ts`) | `postgres.railway.internal` in Railway — keeps queries on the private network |
| `DATABASE_PUBLIC_URL` | migrations (`drizzle.config.ts`) | the `*.proxy.rlwy.net` host — drizzle-kit runs from a laptop or CI and cannot reach `*.railway.internal` |

`drizzle.config.ts` falls back to `DATABASE_URL` when `DATABASE_PUBLIC_URL` is
unset, so a local setup with a single public URL keeps working.

- **A connection `Pool` is correct here**, not a per-request client. This app runs
  as a long-lived container (`output: 'standalone'`), not serverless. The pool is
  cached on `globalThis` outside production so dev hot-reloads don't leak pools.
- **SSL is `{ rejectUnauthorized: false }`.** Railway's proxy terminates TLS with
  a certificate that does not chain to a public root, so strict verification
  fails — but the connection genuinely is TLS 1.3 (confirmed via `pg_stat_ssl`).
  This protects confidentiality, not against an active MITM.
- **`drizzle.config.ts` loads `.env.local` itself** via a small inline loader,
  because drizzle-kit runs outside Next.js and does not get it for free.

### Migrations run manually, from a laptop

Decided deliberately for a one-week single-developer project: a Railway
pre-deploy hook means a bad migration blocks **every** deploy with logs as the
only feedback. Manual keeps failures visible and rollback trivial.

```bash
pnpm db:generate    # review the SQL in drizzle/ before applying
pnpm db:migrate     # apply against DATABASE_PUBLIC_URL
git push            # then deploy
```

**The tradeoff is real: schema and deployed code can drift if you forget.**
Revisit and add a pre-deploy hook once the model settles or a second developer
joins.

### Zod schemas mirror the tables

`createInsertSchema`/`createSelectSchema` from `drizzle-zod`, defined in the same
file as the table, with hand-written refinements for what Drizzle cannot express
(the `status`/`cadence` unions, JSONB shapes). Feature folders import and extend
these rather than redefining them.

> ⚠️ **Overriding a column that has a Postgres default makes it required on
> insert** unless you add `.optional()`. The override replaces the whole type,
> optionality included. This silently broke `status`, `auto_complete_rule`, and
> the `role_profile` JSONB columns before it was caught.

`raw_event.payload` is intentionally `z.unknown()` — the table stores events
verbatim before any parser exists.

---

## Critical Conventions

- **React Query** for all data fetching — see the SSR pattern above
- **API layer** per feature — `api/types.ts` → `api/service.ts` → `api/queries.ts` → `api/mutations.ts`; queries use key factories; components never import mock APIs directly
- **nuqs** for URL search params — `searchParamsCache` on server, `useQueryStates` on client, `getSortingStateParser` for sort on both
- **Icons** — only import from `@/components/icons`, never from `@tabler/icons-react` directly
- **Forms** — use `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`), never import `<Heading>` manually
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent. Tooling is **oxfmt + oxlint** (`pnpm format`, `pnpm lint`), not Prettier/ESLint

## Day-1 notes

- Production Clerk instance will need restricted mode re-enabled — it's per-instance and defaults off
- New teammates join via Users → Invitations, not self-serve sign-up
- Middleware uses deprecated `createRouteMatcher`; new protected routes should use resource-based checks
- `/dashboard/overview` has ~3s artificial delays to strip when you replace it
- `src/app/api/sentry-check/route.ts` is a **temporary** public throw-route for verifying Sentry. Delete it once verified.
- `docs/prd.md` is still missing and is a Day-1 deliverable
