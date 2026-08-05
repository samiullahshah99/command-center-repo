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
- **[docs/webhook-contract.md](./docs/webhook-contract.md)** — The five inbound signature schemes, field by field. Reference for what we RECEIVE; our own `X-CC-*` spec was never adopted
- **[docs/frontend-data-contract.md](./docs/frontend-data-contract.md)** — ⚠️ **The mockup frontend is the fixed contract, per team-lead direction.** Every screen, every data-driven element, and the field-level schema it implies. The backend is audited against this document
- **[docs/urls.md](./docs/urls.md)** — Production base URL, endpoints, Slack app + channel IDs
- **[docs/week-1-exit-test.md](./docs/week-1-exit-test.md)** — Repeatable end-to-end ingest check with the exact SQL per step
- **[fixtures/extraction-eval/README.md](./fixtures/extraction-eval/README.md)** — Eval harness: metric definitions, why `real/` is empty, fixture scrub rules
- **[docs/prd-amendments.md](./docs/prd-amendments.md)** — Decisions that supersede the PRD. Authoritative while the PRD is absent
- **docs/prd.md** — _Not yet committed._ Product requirements. Read the amendments file first: several of its sections are already superseded.

## Removed from this template

Clerk Organizations (multi-tenant workspaces/teams), Clerk Billing/subscriptions,
navigation RBAC (it was powered by org membership), and the Kanban, Chat,
Notifications, Forms-demo, React Query demo, and Icons pages. **Clerk auth is
still in use.** Do not reintroduce `useOrganization`, `<Protect>`, `has({ plan })`,
`PricingTable`, or `NavItem.access`.

---

## Architecture invariants

### Feature folder anatomy

`src/features/products/` is the canonical example **of the folder shape**. New
features replicate it exactly.

> ⚠️ **Copy the shape from `products`, the service layer from `tracker`.**
> `products` and `users` are template leftovers whose `service.ts` returns mock
> data and is not `'use server'` — see
> [Route-handler placement](#route-handler-placement). Copying that file wholesale
> reintroduces the mock path into a real feature.

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

### Which features are real — three tiers, and they look identical from the tree

`src/features/` has 17 folders. Knowing which tier one is in is not inferable
from its name, and picking the wrong one to copy is the common mistake.

| Tier | Folders |
| --- | --- |
| **Real, DB-backed** | `tracker`, `extraction`, `people`, `person-profile`, `briefs`, `home`, `connector-health`, `role-profiles`, `identities`, plus the non-UI `connectors`, `identity`, `normalise` |
| **Template leftovers — mock data** | `products`, `users` |
| **Mockups — screenshots, not features** | `tracker-mockups` |
| **Clerk UI shells — no data layer** | `auth`, `profile` |

> ⚠️⚠️ **`tracker-mockups` is NOT `tracker`, and it contains a rule-breaking
> constant on purpose.** `MOCKUP_TODAY = '2026-08-12'` is hardcoded so the
> today-line and overdue bars land where they were designed and screenshots stay
> identical whenever reopened. **A live feature must never do this** — real
> features resolve `now` once above the tree and thread it down
> (`formatDueDate(due, now)`; see how `tracker/components/board-table.tsx` pins
> it with `useMemo`). The file says so at the top; the risk is copying the
> pattern out of it without reading that far.

`design/mockup/*.dc.html` is the source those screens were built from and
[docs/frontend-data-contract.md](./docs/frontend-data-contract.md) is the
field-level contract derived from it — **the mockup is fixed, per team-lead
direction, and the backend is audited against it.**

### Zod schema location

Schemas live at `src/features/<feature>/schemas/<entity>.ts`. Verified:
`src/features/products/schemas/product.ts`,
`src/features/users/schemas/user.ts`.

When the database arrives, Zod schemas **mirror** the Drizzle table definitions
— they do not replace them. Drizzle owns the DB shape; Zod validates at the
boundary (forms, route handlers, external payloads).

### Route-handler placement

**The data-access pattern is SETTLED: Pattern 1, Server Actions + ORM.** Eight
features use it — `tracker`, `extraction`, `people`, `briefs`, `home`,
`connector-health`, `role-profiles`, `identities`. Their `service.ts` is
`'use server'` and imports `@/db` directly.

> ⚠️ `api/products` and `api/users` are **template leftovers** — the only two
> services still returning mock data and the only two without `'use server'`.
> They are not the example to copy. `src/features/tracker/api/service.ts` and
> `src/features/identities/api/service.ts` are.

Two consequences that are easy to get wrong:

1. **Every export in a `'use server'` file must be an async function.** That is
   the Server Actions contract, and it is why types live in `./types.ts` and
   constants in `./constants/` rather than beside the queries — a non-async
   export there fails the build.
2. **Resource-based auth on EVERY export**, never a reliance on `src/proxy.ts`:
   `const { userId } = await auth(); if (!userId) …`. A Server Action is its own
   reachable endpoint and the route matcher does not cover it.

Route handlers live at `src/app/api/<resource>/route.ts` (per-item at
`[id]/route.ts`) and are reserved for

1. **Inbound webhooks** — `api/webhooks/{slack,clickup,fireflies}` plus the
   internal UGC/Vision handlers
2. **Callers that are not a React query** — `api/nav-badges`, `api/extraction/[id]/fetch`
3. **BFF proxying** — where the browser must not hold a backend token

and _not_ as the primary read path.

> **Why the indirection exists at all:** `queries.ts` is consumed on BOTH sides
> of the SSR handoff. The server prefetches through it, and the browser re-runs
> the same `queryFn` on invalidation after an inline edit — where Drizzle and
> `pg` cannot run. The Server Action is what lets one `queryFn` serve both.

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
  const filters = { page: searchParamsCache.get("page") /* … */ };
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
  all: ["products"] as const,
  list: (filters: ProductFilters) =>
    [...productKeys.all, "list", filters] as const,
  detail: (id: number) => [...productKeys.all, "detail", id] as const,
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

### ⚠️ The client/server boundary: a client component may NEVER import `@/db`

DB access lives behind `'use server'` functions, callable as RPC from the
browser. A `'use client'` component consumes them through a TanStack `queryFn`
— never by importing a DB module. `src/features/people/api/service.ts` documents
the contract at the top of the file.

> **The failure mode is why this is stated so loudly.** A client component
> imported a _constant_ from a module that also imported `db`, which dragged `pg`
> into the browser bundle. The build failed with **seven** Turbopack errors
> naming `dns`, `net`, `tls`, `fs` and `util/types` **inside pg internals** —
> not one of which mentions the import that caused it. It reads as a broken
> dependency, so the search starts in `node_modules` instead of at the boundary.

**Two guards, and they cover different halves:**

1. **`import 'server-only'`** at the top of any shared module that touches the
   DB — currently `src/lib/brief-fold.ts` and `src/lib/nav-counts.ts`. A client
   import then fails the build with _"This module cannot be imported from a
   Client Component module"_, naming the actual rule.
2. **`pnpm lint:boundaries`** (`scripts/check-client-boundaries.ts`) scans every
   `'use client'` file for forbidden specifiers.

> ⚠️ **`server-only` CANNOT be applied to `src/db/index.ts`**, which is the module
> that actually pulls in `pg`. It resolves to a module that **throws** under
> Node's default condition, and 14 tsx scripts (`db:seed`, `events:attribute`,
> `renormalise`, `eval:extraction`, …) plus the node-env vitest suites import
> `@/db` directly. Marking it would break every one of them. That gap is exactly
> what `lint:boundaries` exists to cover.

> ⚠️ **`@/db/schema/*` IS client-safe and must stay allowed.** Schema modules pull
> in `drizzle-orm/pg-core` — a query builder with no driver — so importing a
> constant like `TRACKED_ITEM_STATUSES` or `IDENTITY_SOURCES` into a client
> component is fine, and two components already do it. A first version of the
> check forbade all of `@/db/*` and flagged both as errors. **A gate that fails on
> working code gets switched off**, so the rule is scoped to `@/db` exactly (the
> pool) and `drizzle-orm/node-postgres` (the driver adapter).

**Splitting a shared module when a client needs part of it:** keep the
client-safe half in its own file with no DB import. `src/lib/brief-states.ts`
(states, labels, event→state map) is the client-safe half of
`src/lib/brief-fold.ts` (the query) for exactly this reason.

### Data model & naming

From PRD §6:

- **snake_case** for all table and column names.
- **Singular** entity names: `person`, `role_profile`, `tracked_item`,
  `recurring_task`, `completion_event`, `raw_event`.

> ⚠️ **THE COMMAND CENTRE IS THE TASK SYSTEM OF RECORD** (amendment
> 2026-08-04). Approved action items become native `tracked_item` rows on the
> in-platform board at `/dashboard/tracker`. See
> [Task system of record](#task-system-of-record-the-command-centre).
>
> **No external task tool is written to.** ClickUp stays a **read-only**
> transitional source for content-team outputs. Notion is **not** integrated for
> tasks.
>
> **Whatever the destination, do not duplicate its task data.** `tracked_item`
> holds a reference and no mirrored title, status, assignee or due date beyond
> what a join needs. Duplicating it guarantees drift and there is no
> reconciliation story. If a view needs task detail, read it from the source.

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

These are crawler _requests_, not access control. Actual protection is Clerk on
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

## LLM access

- **Every LLM call goes through `src/lib/ai/client.ts`. No inline `fetch`,
  anywhere, for any reason.** One module is the only place that knows about
  retries, timeouts, cost logging and model slugs.
  > **Why it is a hard rule and not a preference:** the provider behind that
  > module is expected to change — OpenRouter today, possibly a direct Anthropic
  > key later. Nothing outside `src/lib/ai/` may know which. One inline `fetch`
  > in feature code turns a one-file swap into a hunt, and the call it skips is
  > also the one that is not logging its cost, so the first symptom is a bill
  > that does not reconcile rather than a compile error.
- **The vendor is named in exactly ONE file: `src/lib/ai/provider.ts`.**
  It owns the base URL, the slugs, the pricing table and `PROVIDER_NAME`.
  `client.ts` exposes `complete()` in terms of TIERS (`fast` / `default` /
  `heavy`), never slugs. Feature code asks for a tier.
- **`OPENROUTER_API_KEY` is server-side only.** Never prefix it `NEXT_PUBLIC_` —
  that inlines the key into the client bundle and leaks it to every visitor.
- **`createProviderClient()` is a FUNCTION, never a module-level constant.**
  A constant is evaluated at import time, which during `next build` means no
  env vars — the same mistake that once broke the Docker build via `src/db`.

### Model slugs are PINNED — never a `~latest` alias

Verified against the live OpenRouter catalog. Slugs move; re-check with
`curl -s https://openrouter.ai/api/v1/models` before pinning new ones.

| Tier      | Slug                         | $/M in | $/M out |
| --------- | ---------------------------- | ------ | ------- |
| `fast`    | `anthropic/claude-haiku-4.5` | 1.00   | 5.00    |
| `default` | `anthropic/claude-sonnet-5`  | 2.00   | 10.00   |
| `heavy`   | `anthropic/claude-opus-5`    | 5.00   | 25.00   |

> ⚠️ **A floating alias changes prompt behaviour with no code change.** The
> extraction prompt is tuned against a specific model; when the alias moves, the
> output shifts underneath a diff nobody wrote, on a deploy nobody made. Git
> blame shows nothing, the eval was last green, and the regression looks like
> data drift. Pin the exact slug and change it deliberately, with
> `pnpm eval:extraction` run either side of the change.

A `:batch` variant exists for most slugs at ~50% cost with async delivery —
worth using for scheduled work (nightly role monitors, Control Tower recompute)
where latency does not matter.

### `temperature: 0` on every call — and why that is NOT determinism

`complete()` sets `temperature: input.temperature ?? 0`
(`src/lib/ai/client.ts`). Every call gets it unless one is deliberately passed;
a test asserts the default. **Do not raise it for extraction.**

> **Why 0:** extraction is a deterministic task — the same transcript should
> yield the same items. At the provider default (~1.0) output varies run to run
> on identical input, and two things break:
>
> 1. **`pnpm eval:extraction` stops working as a regression gate.** A score
>    moving 92% → 88% could be a worse prompt or could be sampling, and there is
>    no way to tell. A gate you cannot read is worse than no gate, because it
>    still gets quoted.
> 2. **Demos stop being repeatable.** Re-running the same meeting in front of
>    someone produces different items, different wording and different
>    confidence numbers than the run you rehearsed.

> ⚠️ **MEASURED, and the headline is uncomfortable: temperature 0 is necessary
> but NOT sufficient. It does not make output reproducible on this route.**
>
> What was actually established, each by direct probe:
>
> | Question                                | Finding                                                                                                                                                                       |
> | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | Is `temperature: 0` reaching the model? | **Yes.** "Pick a random number 1–1000" × 6: temp 0 → 2 distinct answers, temp 1 → 3, with one value dominating at 0. The distribution collapses, so the parameter is honoured |
> | Is it _greedy_?                         | **No.** Those 2 distinct answers at temp 0 (`742`/`487`) are a token-level flip, not a rewording                                                                              |
> | Is OpenRouter routing between backends? | **No.** 4 identical calls all served by `Amazon Bedrock`, same slug — and output still differed, 943→1346 completion tokens                                                   |
> | Does `seed` help?                       | **No.** `seed: 12345` changed nothing, and no `system_fingerprint` is returned. Anthropic models have no seed parameter                                                       |
>
> So the variance is in the serving stack, not in our parameters or our routing.
> **There is no configuration that fixes this. Stop looking for one.**
>
> Across runs of the same fixture:
>
> | Field         | Stable?                                                   |
> | ------------- | --------------------------------------------------------- |
> | item count    | ✅ always 4                                               |
> | `owner_name`  | ✅ identical                                              |
> | `due_date`    | ⚠️ identical except the one genuinely ambiguous date      |
> | `source_span` | ⚠️ same line, but the **quoted window widens or narrows** |
> | `description` | ❌ reworded every run                                     |
> | `confidence`  | ❌ 0.70 / 0.55 / 0.65 for the same item                   |
> | `follow_ups`  | ❌ reworded                                               |
>
> **The design rule that follows: never key anything on model wording.** Judge
> extraction on the fields that hold — owner, date, and which transcript line
> was cited — never on the prose.
>
> - ✅ The **eval harness is already safe**: it anchors on the `source_span`
>   line rather than the description, and three consecutive runs produced
>   identical scorecards while the raw JSON differed every time.
> - ❌ **`content_hash` is not** — it exact-matches a span the model does not
>   reproduce exactly. See
>   [content_hash](#content_hash-gives-idempotency-on-re-extraction).
> - ❌ **Repeatable demos are not solved by temperature.** If a demo must be
>   identical every time, the only mechanism that delivers it is replaying a
>   stored response — cache the model output keyed by a hash of the prompt and
>   serve it back. That is a deliberate feature, not a config flag; it does not
>   exist yet.

### JSON mode is NOT reliable through OpenRouter

**Do not pass `response_format` / rely on JSON mode.** OpenRouter's support for
structured output varies by model _and_ by which upstream provider the request
is routed to. The flag is accepted and silently ignored on some routes.

Instead, and in this order:

1. Ask for **bare JSON explicitly** in the prompt — "no markdown fences, the
   first character must be `{`".
2. **Strip fences defensively** anyway (`stripFences` in
   `src/features/extraction/prompt.ts`) — handles ` ```json `, bare fences, and
   prose either side.
3. **Zod is the actual guarantee.** A malformed response THROWS.

> **Why not just set the flag and see:** it works in testing and fails in
> production, because the routing decision is not ours and is not stable. The
> failure is a fenced reply that a strict parser rejects — indistinguishable
> from the model having a bad day, on a code path that has not changed.

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
- **Real events ARE signed** with `x-hub-signature`. Their _setup test_ pings are
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

| Provider  | Headroom headers                                                   | Signal                                                                                             |
| --------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| ClickUp   | ✅ `x-ratelimit-limit` / `-remaining` / `-reset` on every response | 100/min on our plan; `-reset` is epoch **SECONDS**                                                 |
| Slack     | ❌ **none at all**                                                 | Only `Retry-After` on a 429 — i.e. after the fact. Per-METHOD tiers. Does return `x-oauth-scopes`. |
| Fireflies | ❌ none                                                            | Limit is per **DAY**, so a 429 matters far more                                                    |

`src/features/connectors/rate-limit.ts` logs ClickUp headroom per call and warns
below 20% or 10 remaining. It cannot do the same for Slack — writing one shared
"log the remaining quota" helper would silently log nothing for Slack while
looking like it worked.

### Permanent vs transient failures

Do **not** retry a plan or auth failure six times. `classifyTranscriptFetchError`
splits them, and a permanent one throws `PermanentJobError`, which the worker
turns into pg-boss's `deadletter` status on the **first** attempt.

| Permanent                             | Transient                                    |
| ------------------------------------- | -------------------------------------------- |
| plan / subscription (`paid_required`) | 429 rate limit                               |
| auth failure, 401/403                 | 5xx                                          |
| response shape changed                | network error                                |
| non-429 4xx                           | "not found" **within** 30 min of the webhook |

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
> nobody goes looking for that. Names may appear as an _unverified suggestion_ in
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

---

## Week 2 Day 1 — the extraction service

### Task system of record: THE COMMAND CENTRE

**Amendment 2026-08-04** — recorded in full in
[docs/prd-amendments.md](./docs/prd-amendments.md), which is the authoritative
record of superseded PRD decisions while `docs/prd.md` is absent.

Supersedes PRD §3.2 ("ClickUp is authoritative for tasks"), PRD §5.1 (meeting
action items sync into ClickUp), §5.8 in part (Notion's role), and the Week 2
statement that Notion is the task destination.

- **The Command Centre is the task system of record.** Approved action items
  become native `tracked_item` rows, surfaced on the in-platform tracker board
  at `/dashboard/tracker`.
- **No external task tool is written to.** Not ClickUp, not Notion.
- **Slack is the notification and update surface** — where people are told
  something changed, never where the task itself lives.
- **ClickUp: read-only, transitional, unchanged.** A source of content-team
  events, nothing more.
- **Notion: not integrated for tasks.** A read-only mirror into Ocean is an
  explicitly possible phase-2 add-on; the schema already supports it via
  `source_system` plus the external reference columns. See
  [Phase 2: read-only Notion mirror](#phase-2-read-only-notion-mirror-not-built).

> **Rationale, from the amendment:** Monday-model product direction from
> leadership; eliminates two-way-sync loop risk, external rate limits and
> member-mapping ahead of the Aug 13 delivery; and makes the Command Centre the
> single source of truth **structurally rather than by convention**.

> ⚠️ **Why this is stated this loudly, still.** The repo contains a ClickUp
> client, `TASK_SOURCE_OF_RECORD`, `tracked_item.source_system = 'clickup'`,
> `'notion'` in the shared `EXTERNAL_SYSTEMS` set, and a PRD that names ClickUp
> as system of record. Every one of those reads like permission to build an
> external write path. **None of them is.** The external columns exist for
> INBOUND mirroring, never outbound sync — see
> [external_task_id semantics](#where-a-destination-is-recorded--external_task_id-semantics).

### Field naming: `external_task_id` / `external_system` — NEVER a vendor name

`candidate_action_item` names the destination generically. There is no
`notion_page_id` column and there must not be one.

> **Why:** a full day of ClickUp-shaped work had to be retargeted when the
> destination changed. A column called `clickup_task_id` is a migration, a
> backfill and a rename across every query the day the vendor changes — and the
> vendor changed once already, mid-project, by a decision made above this repo.
> Generic naming made the second change a config concern instead of a schema
> one. `external_system` is CHECK-constrained to `('notion','internal')`, and
> `external_task_id`/`external_system` are constrained to be set together.

### ONE extraction path, shared between meetings and Slack

**The action-item contract is shared.** One worker, one schema, one prompt:

|        |                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| Queue  | `extract.action-items` (**not** a `parse.*` queue — it runs after normalisation and belongs to no connector) |
| Input  | a `unified_event` id                                                                                         |
| Schema | `src/features/extraction/schemas/action-item.ts`                                                             |
| Output | `candidate_action_item` rows, all `review_status='pending'`                                                  |

> ⚠️ **A second extraction path is a design failure, not a shortcut.** Slack
> (Day 3) reuses this worker and this schema. Two paths means two prompts to
> keep in sync, two sets of scores that cannot be compared, two idempotency
> stories, and a review queue whose rows mean different things depending on
> where they came from. The eval harness would then measure only one of them
> while appearing to cover extraction as a whole.

**Extraction runs per MEETING, not per message.** Slack batches per **thread**.

> **Why:** cost and quality both scale with the unit. A per-message call on a
> busy workspace is thousands of calls a day, nearly all on messages containing
> no commitment — and each one is judging a single line stripped of the
> conversation that gives it meaning. `"I'll take that one"` is unresolvable
> alone and obvious in a thread. Per-thread keeps call volume proportional to
> **conversations**, which is the unit a commitment actually lives in.

### `source_span` is MANDATORY

Every extracted item carries a verbatim quote from its source. Not optional, not
nullable, minimum 10 characters.

> **Why it is load-bearing rather than nice-to-have:** the entire design rests on
> a human reviewing proposals before anything becomes a tracked task. A reviewer
> confronted with "Dana will send the numbers by Friday" and no quote has to
> re-listen to the meeting to check it — so they will not check it, they will
> approve on vibes, and the review step becomes a rubber stamp that adds latency
> and no safety. The quote is also what makes hallucination measurable at all:
> `pnpm eval:extraction` checks each span against the transcript mechanically,
> with no labels needed.

### `content_hash` gives idempotency on re-extraction

`candidate_action_item.content_hash` is a **global** UNIQUE index; writes are
`ON CONFLICT DO UPDATE`. Re-running extraction on the same transcript updates in
place instead of duplicating.

- The hash is over **`owner_name` + `source_span`**, deliberately **not** the
  description. Models paraphrase — a real re-run produced "Email the updated
  slide deck" for a commitment it had previously called "Send the revised deck".
  Hashing the description would file the same commitment twice on every re-run.
- ⚠️ **`review_status`, `reviewed_by`, `reviewed_at`, `edited_fields` and
  `external_task_id` are EXCLUDED from the update set.** A re-extraction must
  never undo a human decision. Without this, re-running would return an approved
  item to the queue — or clear `external_task_id`, the column a future inbound
  mirror would key on.

> ⚠️⚠️ **KNOWN GAP: the guarantee is weaker than it looks, because the model
> does not return an identical `source_span` every time.**
>
> Measured on the live model at temperature 0: across three runs of one fixture,
> one item's span widened from `"I'll take that one."` to
> `"Someone needs to get through those before the end of the month or we'll be
publishing stale content. I'll take that one."` — the same commitment, quoted
> with more context. Different span → different hash → **`ON CONFLICT` does not
> fire and a duplicate pending row is created.**
>
> **Why this was not caught by the idempotency test:** that test mocks the model
> with a FIXED response, so it proves Postgres upserts correctly and proves
> nothing about whether the input is stable. It is a true test of the wrong
> thing.
>
> Blast radius is bounded — a re-run adds duplicate rows with
> `review_status='pending'`; it does not lose data, does not touch an approved
> row, and cannot double-promote, because the partial unique index
> `tracked_item_candidate_key` allows one tracked_item per candidate. The visible symptom is "why are there two of this action
> item after a backfill?", which reads like a queue bug rather than a hashing
> one.
>
> **Do not fix this by hashing the description instead** — descriptions vary far
> more than spans (reworded on every single run). The fix is to stop requiring
> exact equality: look up existing candidates for the same `unified_event_id`
> and match on span _overlap_ before inserting, which is what the eval scorer
> already does. That is a deliberate design change, not a patch — leave the
> exact-hash path until it is made.

### Owner resolution: names are NEVER an auto-match

Order is **exact** → **email** → **fuzzy** → **unresolved**.

| Confidence   | Meaning                                                            | Auto-linkable                   |
| ------------ | ------------------------------------------------------------------ | ------------------------------- |
| `exact`      | an already-linked `person_identity` for this display name          | ✅                              |
| `email`      | roster email match, where the local part resembles the spoken name | ✅                              |
| `fuzzy`      | a name **suggestion**                                              | ❌ mandatory human confirmation |
| `unresolved` | no confident answer, including ties                                | ❌                              |

- **`fuzzy` may only ever appear on `candidate_action_item`**, which is a review
  queue. `person_identity`'s CHECK has no such value and rejects it — verified
  by a test. On approval the link is created as `'manual'`, because by then a
  human really did confirm it.
- **Ambiguity resolves to `unresolved`, not to the better score.** Two roster
  names within 0.08 of each other produce no suggestion at all.
  > A reviewer skimming a queue tends to accept whatever is pre-filled, so a
  > coin-flip suggestion launders a guess into an approval.
- **An email is only trusted when its local part resembles the spoken name**,
  never by position in `participants[]`. Fireflies' `speakers[]` is `{id, name}`
  with no email and nothing links a speaker to a participant entry.

> ⚠️ **Email is the ONLY automatic cross-system key**, because Vision, UGC and
> Command Centre are **three separate Clerk instances** — ids are not comparable
> between them and may collide. Identity is always the pair
> `(source, external_id)`. Two people can share a display name, and a wrong
> auto-link silently attributes one person's work to another; nobody goes
> looking for that, because nothing looks broken.

### `pnpm eval:extraction` is the regression gate

**Run it before AND after any prompt change**, and on any model-slug change. It
scores owner accuracy, recall, precision and hallucination rate against
hand-labelled fixtures and exits non-zero below threshold.

> ⚠️ **The synthetic fixtures test the HARNESS, not real-world accuracy.** They
> were authored knowing what the prompt says, they are far cleaner than real
> Fireflies output (no crosstalk, no ASR errors, correct speaker attribution),
> and n = 3. `fixtures/extraction-eval/real/` is **empty** and real accuracy is
> **unmeasured** — Fireflies returns a paid-plan error for transcripts the token
> holder does not own, and the dedicated test account has no meeting history.
> **Never report a synthetic score as a real one.** The runner prints real and
> synthetic separately and refuses to blend them.

> ⚠️ **Known weakness, measured:** deleting rule 1, inverting it, and removing
> the entire `Do NOT extract:` block from the prompt each changed the score by
> **nothing**. These cases cannot currently catch a precision regression on
> Sonnet 5. Forcing a wrong `owner_name` and forcing a fabricated `source_span`
> both DO fail the gate, so the harness works — but a green run means "the
> pipeline is intact", not "the prompt is good". Details in
> `fixtures/extraction-eval/README.md`.

**The score is stable run to run even though the model output is not** — three
consecutive runs gave identical scorecards while the raw JSON differed every
time. That is by design: the scorer anchors on `source_span` and tolerates
description drift ([temperature](#temperature-0-on-every-call--and-why-that-is-not-determinism)).

> ⚠️ But that was measured at a **100% ceiling**, where variance is least
> visible — nothing can move up. Do not assume a mid-range score is equally
> stable. Before treating a change of one or two points as a real improvement,
> run the eval **twice on the unchanged prompt** and see how much it moves on
> its own.

The eval calls the live model (~$0.04/run), so it is a deliberate gate, not a
per-commit CI step.

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

| Source    | Header                   | Prefix    | Basestring       | Replay window |
| --------- | ------------------------ | --------- | ---------------- | ------------- |
| Slack     | `X-Slack-Signature`      | `v0=`     | `v0:{ts}:{body}` | ✅ ±300s      |
| UGC       | `X-LuckyFours-Signature` | `sha256=` | `{ts}.{body}`    | ✅ ±300s      |
| Vision    | `X-Vision-Signature`     | `sha256=` | `{body}`         | ❌ none       |
| ClickUp   | `X-Signature`            | _(none)_  | `{body}`         | ❌ none       |
| Fireflies | `X-Hub-Signature`        | `sha256=` | `{body}`         | ❌ none       |

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
> Fireflies' v2 body _does_ carry a millisecond `timestamp`, and because the
> signature covers the body an attacker cannot alter it — so it could bound
> replay. It deliberately does not: the payoff of a replay is an idempotent
> re-fetch, while a wrong window permanently drops a delayed retry from a sender
> whose retry behaviour is undocumented.

### Setup test events use constant ids

UGC sends `test.ping` with id `evt_test`; Vision sends `control_center.test` with
an all-zero id. Deduplicating on a constant id would make the _second_ ping
vanish — during setup that looks exactly like a broken handler. Both are stored
with a **null** `external_id` so every ping lands, and logged as `TEST EVENT`.

### Fireflies: the published docs describe a DEPRECATED webhook

**`https://docs.fireflies.ai/graphql-api/webhooks` is not to be trusted.** It
documents the v1 (Developer Settings) webhook. Fireflies has replaced it with a
v2 system configured on the **Integrations page**, and the v2 payload differs on
_every_ field. Confirmed from live deliveries sent by `Fireflies-Webhook/2.0`:

```json
{ "event": "test", "timestamp": 1785510895435, "meeting_id": "test_00000000" }
```

| v1 — docs, deprecated | v2 — actual                          |
| --------------------- | ------------------------------------ |
| `meetingId`           | `meeting_id` — **snake_case**        |
| `eventType`           | `event`                              |
| `clientReferenceId`   | _does not exist_                     |
| _not mentioned_       | `timestamp` — epoch **milliseconds** |

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
  and `verifyBodyOnly` is correct. The _body_ timestamp could bound replay, and
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
  brief creation plus studio stats APIs will replace it.
- ⚠️ **READ-ONLY.** PRD §3.2 names ClickUp as system of record and §5.1 requires
  meeting action items to sync into it. **Both are superseded** by the
  2026-08-04 amendment: the Command Centre is the task system of record and no
  external task tool is written to. ClickUp is only a source of content-team
  events.
- **Do not build deeper ClickUp coupling, and do not build a write path at all.**
  The client is a thin typed wrapper; person→ClickUp user mapping, list
  selection, and status taxonomy mapping are deliberately absent and TODO-marked
  — those TODOs are now **dead**, not a backlog.
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
- **DMs work with `chat:write` alone — `im:write` is NOT needed** (verified).
  `conversations.open` returns a DM channel id, and `chat.postMessage` to that id
  succeeds on `chat:write`.
  > **Why it matters that this was checked rather than assumed:** requesting an
  > unnecessary scope means a **reinstall**, and new scopes do not apply to an
  > existing installation — the `users:read.email` reinstall already cost a round
  > trip in Week 1. Asking for scopes you do not need also makes the consent
  > screen harder to get approved.
- **The bot user id is `U0BLNND61QR`. Use it as the loop guard.**
  > Every message the bot posts comes straight back as an `event_callback`. With
  > no guard, a bot that replies to messages replies to its own reply — an
  > infinite loop that is billed per LLM call and looks, from the outside, like a
  > runaway worker rather than a missing `if`. Compare against the bot **user
  > id**, not the app id and not the display name.

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

| Provider    | Header                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Slack       | `Authorization: Bearer xoxb-...`                                           |
| **ClickUp** | `Authorization: <token>` — **raw, NO `Bearer` prefix**                     |
| Notion      | `Authorization: Bearer ...` **plus** the mandatory `Notion-Version` header |
| Fireflies   | `Authorization: Bearer ...`, GraphQL only                                  |

Each `authHeaders()` **throws** on a missing env var rather than sending
`Bearer undefined`, which produces the same ambiguous 401.

## Notion — company AI search, and a possible phase-2 mirror

**Notion is NOT the task destination.** That was the Week 2 position and it is
superseded by the 2026-08-04 amendment — the Command Centre is the task system
of record and no external task tool is written to. See
[Task system of record](#task-system-of-record-the-command-centre).

What Notion is still for:

1. **Company AI search** (PRD §5.8), reading pages shared with the integration.
2. **A possible phase-2 READ-ONLY mirror** of Ocean projects into the tracker.
   Explicitly not built.

- Base URL `https://api.notion.com/v1`, `Authorization: Bearer <token>`.
- **PULL-ONLY.** Notion has no webhook API for internal integrations, so it does
  **not** fit the `raw_event` inbound-webhook pattern the other connectors use.
  It has to be polled or fetched on demand, which is a different shape — do not
  assume the Slack/Fireflies design transfers.

Verify the credential and list shared databases with `pnpm verify:notion`
(`scripts/verify-notion.ts`). That script is read-only and is not the client.

The client will live at `src/features/connectors/notion/` once there is a reason
to build one. There is currently no Notion client and no Notion write path.

### Phase 2: read-only Notion mirror (NOT BUILT)

⚠️ **Nothing below is current behaviour.** It is API knowledge that cost real
time to establish, kept because a read-only Ocean mirror is a live possibility.
Do not read any of it as describing something the system does today.

- **`Notion-Version` is mandatory on every request** (currently `2022-06-28`).
  Omitting it returns `400 validation_error` — there is no default version.
- **Deny-by-default per page.** An integration sees nothing until a page or
  database is explicitly shared with it (⋯ → Connections → Command Center).
  Sharing a _parent_ page cascades to its children.
  > A `404 object_not_found` here almost always means "not shared", **not**
  > "wrong ID". Chasing the ID is the standard wasted hour.
- **Rate limit ≈ 3 requests/second** average. Bursts get `429`. Any batch read
  must be paced.
- **Cursor pagination on every list endpoint** — `has_more` / `next_cursor`.
  Reading only the first page silently under-reports.
- **A `people` property accepts ONLY Notion workspace members.**
  > This mattered when Notion was the write destination: an owner who was not a
  > workspace member failed the write, per item, after a human had already
  > approved it. `ownerIsPushable()` existed to catch that up front and **has
  > been deleted** along with the push path — a helper encoding a superseded
  > decision is worse than no helper. A read-only mirror does not need member
  > mapping at all, which is one of the reasons the amendment names it as a
  > cost eliminated.

> If phase 2 happens, an imported row is `source_system='notion'` with
> `external_task_id` set — an ORIGIN pointer meaning "this row mirrors Notion".
> It is never a push destination. See
> [external_task_id semantics](#where-a-destination-is-recorded--external_task_id-semantics).

---

## Third-party integrations: develop against DUMMY accounts first

**Security requirement.** Any new third-party integration is built and tested
against a dedicated dummy/test account. Real workspace credentials are swapped
in only after the integration works.

> **Why this is a rule and not caution:** early integration code sends malformed
> requests, retries too fast, and occasionally writes. Against the production
> workspace that means real tasks created in front of the team, a real webhook
> registered against a real channel, or a rate-limit strike on the credential
> everything else depends on. Test traffic is also indistinguishable from real
> traffic once it is in the same account.

> ⚠️ **The cost lands on evaluation, and it is a real trade.** A fresh test
> account has **no history** — which is exactly why
> `fixtures/extraction-eval/real/` is empty and real extraction accuracy is
> unmeasured. When an integration needs historical data to be evaluated, raise
> the account question early rather than discovering it at eval time.

## Commands

Package manager is **pnpm** (pinned via `packageManager` in `package.json`).
Ignore any `bun run` references still in AGENTS.md.

| Command                | Purpose                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`         | Install dependencies                                                                                                                                       |
| `pnpm dev`             | Dev server on :3000                                                                                                                                        |
| `pnpm build`           | Production build                                                                                                                                           |
| `pnpm start`           | Serve the production build                                                                                                                                 |
| `pnpm lint`            | oxlint                                                                                                                                                     |
| `pnpm lint:fix`        | ⚠️ **BROKEN** — the script body is `oxlint --fix && bun format`, and bun is not installed. Run `pnpm lint --fix && pnpm format` instead, or fix the script |
| `pnpm lint:strict`     | Zero-warning gate                                                                                                                                          |
| `pnpm format`          | oxfmt                                                                                                                                                      |
| `pnpm format:check`    | Verify formatting                                                                                                                                          |
| `pnpm lint:boundaries` | Scan every `'use client'` file for server-only imports. Currently 131 client components, clean                                                             |
| `CI=1 pnpm build`      | Build with Sentry source-map upload logs visible                                                                                                           |

### Tests — vitest, and 30% of the suite is silently skipped

```bash
pnpm test                                        # whole suite, ~3s
pnpm test:watch                                  # watch mode
pnpm test src/features/connectors/slack/verify.test.ts   # ONE file — positional substring filter
pnpm test slack -t 'rejects a re-serialised body'        # one test by name
```

`environment: 'node'`, `globals: false` — import `describe`/`it`/`expect`
explicitly. Component tests would need jsdom; add
`// @vitest-environment jsdom` per file if that day comes.

> ⚠️ **`vitest.config.ts` sets `env: {}` deliberately, so the suite does NOT
> load `.env.local`.** Nine files are DB-gated behind
> `Boolean(process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL)` and
> turn into `describe.skip` without it. A bare `pnpm test` reports
> **383 passed | 69 skipped** and exits 0 — green, while every test that
> touches Postgres, pg-boss, identity resolution and extraction ran nothing.
>
> **The trap is single-file runs.** `pnpm test src/features/extraction/owner.test.ts`
> prints `1 skipped` in 300ms, which looks like a pass at a glance. If a test
> file you are working on reports 0 assertions, you are missing the env file,
> not passing.

| Command           | Covers                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test:db`    | The DB-gated suites — queue, `ingest`, `ingest-rollback`, identity, normalise, extraction. Runs vitest through `tsx --env-file=.env.local` |
| `pnpm test:queue` | `src/lib/queue` only, same env-file mechanism                                                                                              |

Those two exist because a config-level env load would make every test
implicitly depend on a laptop's secrets. Integration rows are written with a
unique `itest-<pid>-<ts>` external id and deleted afterwards, so they run
against the real database without disturbing the backlog.

### Extraction & LLM commands

All of these spend real OpenRouter credit except `--review` and `--dry`.

| Command                             | Purpose                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm eval:extraction`              | **The regression gate.** Run before and after any prompt or model-slug change. Exits non-zero below threshold. ~$0.04                                        |
| `pnpm eval:extraction --review`     | Print every fixture's retained content in full, for PII review. No model call                                                                                |
| `pnpm eval:extraction --verbose`    | Per-item detail: which owner and date were actually returned, which traps tripped                                                                            |
| `pnpm extract:run --list`           | Meetings with a stored transcript, and how many items each has                                                                                               |
| `pnpm extract:run --dry <id>`       | Size a transcript in tokens without calling the model                                                                                                        |
| `pnpm extract:run <unifiedEventId>` | Extract one meeting and print items + cost                                                                                                                   |
| `pnpm ai:smoke`                     | Verify the OpenRouter credential. Distinguishes auth failure, exhausted credit and an unknown slug — an empty balance otherwise reads exactly like a bad key |

### Database commands

| Command            | Purpose                                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:generate` | Emit a migration from schema changes into `drizzle/`                                                                                                                                                                                                                                                 |
| `pnpm db:migrate`  | Apply pending migrations                                                                                                                                                                                                                                                                             |
| `pnpm db:push`     | Push schema without a migration file — **dev only, never production**                                                                                                                                                                                                                                |
| `pnpm db:studio`   | Drizzle Studio                                                                                                                                                                                                                                                                                       |
| `pnpm db:seed`     | Seeds `role_profile`, `person`, `recurring_task`, plus `tracked_item`/`project` via `src/db/seed-tracker.ts`. **Idempotent** — every write is a lookup-then-insert/update, so re-running leaves row counts unchanged. `completion_event` and `raw_event` stay empty; those are produced by ingestion |

> ⚠️ **Person emails are NOT in the seed, deliberately — this repo is public.**
> Email is the only automatic cross-system identity key, so a roster with no
> emails resolves nobody. Bootstrap them with
> `pnpm people:email "<Name>" <address>` (`--list` to see the roster) after
> seeding, or identity resolution silently links nothing.

### Operational scripts — EVERY mutating one is dry-run by default

The shared convention: **nothing writes without `--commit`.** These scripts
rewrite who real work belongs to, and a wrong link or attribution is silent —
nobody goes looking for it. Read the dry-run output before committing.

| Command | Purpose |
| --- | --- |
| `pnpm renormalise [--commit] [--source=NAME] [--stale]` | Rebuild `unified_event` from `raw_event`. **This is what makes a parser bug a re-run rather than a lost event** — it upserts on `(raw_event_id, source_seq)`, never delete-and-reinsert |
| `pnpm queue:backfill [--commit]` | Enqueue `raw_event` rows that never got a parse job |
| `pnpm identities:backfill <clickup\|slack\|all> [--commit]` | Seed `person_identity` from provider member lists |
| `pnpm identities:relink [--commit] [--source=NAME]` | Re-run resolution over identities already in the table |
| `pnpm events:attribute [--commit] [--source=NAME]` | Stamp `unified_event.person_id` from already-linked identities |
| `pnpm people:email <name> <email>` / `--list` | Bootstrap a person's email (see above) |
| `pnpm verify:exit [--verbose] [--replay]` | Week 1 exit criteria, automated portion — a pass/fail table for the whole ingest pipeline. See [docs/week-1-exit-test.md](./docs/week-1-exit-test.md) |

### Connector scripts

| Command | Purpose |
| --- | --- |
| `pnpm webhook:send <ugc\|vision\|slack\|clickup\|fireflies>` | POST a correctly-signed dummy webhook at your own endpoint. Defaults to **localhost** — never prod by accident. Aliases: `webhook:ugc`, `webhook:vision`, `webhook:slack`, `webhook:clickup` |
| `pnpm verify:clickup` | Read-only. Confirms auth, then walks the workspace to surface the list IDs |
| `pnpm clickup:list` | Read-only. Webhook IDs + health, so a suspended webhook is visible |
| `pnpm clickup:register` | ⚠️ **MANUAL ONLY, never on boot.** ClickUp does not deduplicate registrations — running it twice creates two webhooks and every event then arrives twice |
| `pnpm clickup:delete <webhook_id>` | Clean up the duplicates the above creates |
| `pnpm verify:notion` | Read-only credential check + list of shared databases. Not a client |
| `pnpm fireflies:fixture` | Capture a transcript fixture. **Scrubs PII and refuses to write a file still containing a real name** |

---

## Database (Drizzle + Postgres)

Postgres 18 on Railway. Drizzle ORM with the `node-postgres` driver.

**Two URLs, on purpose:**

| Variable              | Used by                             | Should point at                                                                                          |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | the running app (`src/db/index.ts`) | `postgres.railway.internal` in Railway — keeps queries on the private network                            |
| `DATABASE_PUBLIC_URL` | migrations (`drizzle.config.ts`)    | the `*.proxy.rlwy.net` host — drizzle-kit runs from a laptop or CI and cannot reach `*.railway.internal` |

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

## Where a destination is recorded — `external_task_id` semantics

Three columns share the `EXTERNAL_SYSTEMS` value set
(`src/db/schema/external-system.ts`, one constant, no duplicates). **They do not
mean the same thing.**

| Column                                                        | Meaning                                              |
| ------------------------------------------------------------- | ---------------------------------------------------- |
| `tracked_item.source_system` / `.external_task_id`            | where the row **CAME FROM** — it mirrors that system |
| `candidate_action_item.external_system` / `.external_task_id` | where an approved item was **PUSHED TO**             |
| `project.external_system` / `.external_id`                    | where the project **MIRRORS FROM**                   |

**`tracked_item.external_task_id` means "this row mirrors an external system".**
`tracked_item_external_ref_ck` enforces it: a non-internal row must have one, an
internal row must not.

The push destination of an **internally originated** item is recorded on
`candidate_action_item.external_task_id`, reached from the board via
`tracked_item.candidate_action_item_id`:

```
tracked_item (source_system='internal', external_task_id NULL)
  └─ candidate_action_item_id ─→ candidate_action_item
                                   .external_system  = 'notion'
                                   .external_task_id = <notion page id>
```

> ⚠️ **THERE IS NO OUTBOUND SYNC, and these columns are not for one.** Per the
> 2026-08-04 amendment the Command Centre is the task system of record; approved
> items are native `tracked_item` rows and nothing is pushed anywhere.
>
> If a phase-2 read-only Notion mirror is ever built, an imported row carries
> `source_system='notion'` and `external_task_id` = its page id — an ORIGIN
> pointer. Writing a page id there to mean "we pushed this out" would violate
> `tracked_item_external_ref_ck` _and_ give one column two meanings, which is
> how you end up with a sync that cannot tell an imported task from an exported
> one.

> ⚠️ **KNOWN GAP, accepted:** a **manually created** `tracked_item` has no
> candidate, so it has **no destination slot at all**. Fine while manual items
> are not synced outward. If manual-item sync is ever needed, add a destination
> pair to `tracked_item` — do **not** overload `external_task_id`.

`clickup` is a legitimate **origin** (read-only source for content-team outputs)
but not a legitimate **destination** — no ClickUp write path exists and none is
to be built. The shared CHECK permits the value; the rule is enforced by the
absence of write code, not by the constraint. That asymmetry is deliberate: one
shared constant beats a narrowed CHECK that re-creates value drift.

> `tracked_item.source_system` was a Postgres **enum** until the tracker landed.
> It is now TEXT + CHECK, because `ALTER TYPE ... ADD VALUE` cannot run inside a
> transaction and a value can never be removed. Converted while the table was
> empty. Same reasoning as `tracked_item.status` and `project.status`.

> ⚠️ `tracked_item_content_by_source_ck` is an **allow-list**
> (`source_system = 'internal' OR title IS NULL …`), not a deny-list. It was
> `source_system <> 'clickup' OR …` — a deny-list of one, which silently started
> permitting mirrored Notion titles the moment `'notion'` joined the set, while
> still existing under the same name. Keep it an allow-list.

---

## Candidate rows are IMMUTABLE model output

**Once extraction has written a `candidate_action_item`, its `description`,
`owner_person_id`, `owner_confidence`, `due_date`, `source_span` and
`confidence` are never edited.** A reviewer's corrections go onto the
`tracked_item` created at approval; `edited_fields` records _which_ fields they
had to change. Nothing is written back.

> **Why:** the candidate is the record of what the MODEL produced. Overwrite it
> with a human's correction and the precision metric becomes unanswerable —
> "how often did the model get this right?" has no data left to read, because
> the wrong answer was replaced by the right one. `edited_fields` exists
> precisely so the correction can be recorded without destroying the evidence.
>
> The same logic is why **`source_span` and `confidence` are not editable at
> all**: the span is the quote the item is verified against, and correcting it
> would erase what the reviewer was checking.

The only mutable columns after extraction are the review-decision ones —
`review_status`, `reviewed_by`, `reviewed_at`, `edited_fields` — plus
`external_task_id` / `external_system` if a mirror is ever built.

⚠️ **There is no `'edited'` review status, deliberately.** Editing is not a
different decision; the item was still approved. It is recorded as a qualifier
(`edited_fields` non-empty), not a state, so that every "was this approved?"
query stays `review_status = 'approved'` and cannot silently miss a variant. The
two precision queries live in a comment on the column itself.

---

## Cross-feature imports: constants yes, behaviour no

**Key factories and constants may cross a feature boundary. Services, queries
and mutations may not.**

```ts
// ✅ allowed — a shared token or cache key
import { STATUS_META } from '@/features/tracker/constants/tracker-options';
import { trackerKeys } from '@/features/tracker/api/queries';

// ❌ not allowed — one feature driving another's data layer
import { getBoard } from '@/features/tracker/api/service';
import { updateStatusMutation } from '@/features/tracker/api/mutations';
```

> **Why the line is there:** invalidating another feature's cache after a write
> is unavoidable — approving a candidate really does change what the tracker
> board shows — and hardcoding `['tracker']` string arrays instead would drift
> the moment a key factory changed, silently and with no type error. Importing
> the _key factory_ keeps that honest.
>
> Calling another feature's **service** is different in kind: it makes one
> feature's behaviour depend on another's internals, and the dependency runs in
> both directions the moment the second feature returns the favour. If two
> features need the same behaviour, it belongs in `src/lib` or the DB layer, not
> in an import between them.

---

## AI summaries — caching, labelling, and the empty-state guard

Conventions established by the person profile (`src/features/person-profile/`).
**Week 3's monitors reuse these**; do not invent a second set.

### 1. The two-gate cache. Never call the model on a page render without it

`ai_summary` is a CACHE — one row per subject, upserted, no history (the reason
is written on the unique index; `monitor_report` is the time-series surface).

| condition                      | action                                    |
| ------------------------------ | ----------------------------------------- |
| `input_hash` unchanged         | serve cache, **whatever its age**         |
| hash changed, younger than TTL | serve cache — the rate cap wins           |
| hash changed, at or past TTL   | regenerate                                |
| manual regenerate              | bypass both, **but still write the hash** |

> **Both gates are load-bearing and they do different jobs.** The TTL
> (`SUMMARY_TTL_MS`, one hour) is what _guarantees_ at most one call per subject
> per hour — without it a refresh loop is a billing incident. The `input_hash`
> is what stops a _pointless_ call when the hour lapses and nothing has actually
> moved, which on a seven-person roster is the common case and the difference
> between cents and dollars.
>
> Hash only the fields a summary could legitimately change on — titles,
> statuses, due dates, event ids. **Not `updated_at`**: a touch that changes
> nothing observable must not burn a call.
>
> A manual regenerate that skipped writing the hash would leave the next
> automatic check comparing against a stale fingerprint, so it would regenerate
> again immediately. Force the call, still write the hash.

**The cache must survive a restart**, so it is a table. In-memory alone fails on
every Railway redeploy, which is also exactly when everyone reloads the page.

### 2. Failure never takes the page down

The summary is an enhancement, not the content. A parse failure, a provider
outage or a missing key renders the page **without the card** plus a quiet
regenerate affordance — never a broken page, never a placeholder string standing
in for a summary. `getOrCreateSummary()` does not throw; it returns
`unavailable`. It also falls back to a **stale cached summary** in preference to
nothing — an hour-old summary labelled with its real timestamp beats an empty
card.

Parsing is the extraction hardening pattern, unchanged: no `response_format`,
prompt for bare JSON, strip fences defensively, Zod-validate, throw on garbage.

### 3. ⚠️ The zero-data guard — in CODE, not only in the prompt

**When `item_count + event_count === 0`, the model is not called at all.** The
card renders "Nothing currently tracked for X" from code.

> A "write a summary" instruction against empty lists is an invitation to invent
> one, and a fabricated summary about a real colleague is the single worst output
> this feature can produce. The prompt says be brief; the guard makes the call
> impossible. Prompt rules are a request, code is a guarantee — and this is the
> case where you want the guarantee.

### 4. Double labelling, always

A generated chip **and** a footer caveat — "AI-generated from tracked items and
activity, may be imperfect" — plus the generated-at time through the pinned-date
helper, and what it was built from.

> Not decoration. These summaries are written to be faithful to real data, which
> makes them _more_ likely to be read as authoritative, not less.

### 5. Prompt rules that are not optional

Summaries describe **work**, never the worker, and **never advise**:

```
5. Neutral and factual. This is read by the person's colleagues and may be read
   by the person. Describe work, never the worker.
6. Never recommend actions, assign blame, or suggest what the person should do
   next. Describe, don't advise.
```

> Same failure mode twice. A summary that editorialises about a person, or that
> starts suggesting what they should do next, is performance commentary wearing
> a helpful face. The first one that says someone "seems overloaded" is the one
> that gets the feature switched off.

Send **only that subject's own data** — their items, their events. No transcript
content, no other people's work.

### 6. Trust our counts, not the model's

The response schema asks for `generated_from: { item_count, event_count }` so
the model has to look at the lists — but the values PERSISTED are ours. A model
that miscounts must not make the footer lie.

---

## Dates and numbers in rendered output: PIN THE LOCALE

**Never pass `undefined` (or omit) the locale argument to `toLocaleString`,
`toLocaleDateString`, or `toLocaleTimeString` in anything that renders.** Pin the
locale _and_ the timezone explicitly.

```ts
// ❌ resolves to the HOST's locale — different on server and client
d.toLocaleString(undefined, { month: "short", day: "numeric" });
d.toLocaleString();

// ✅ same string everywhere
d.toLocaleString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
```

> **Why — this cost a demo-day debugging session.** `undefined` resolves to the
> host's locale: Node's during SSR, the browser's during hydration. The same
> timestamp rendered as `31 Jul 2026, 20:55` on the server and
> `Jul 31, 2026, 08:55 PM` on the client, React declared a hydration mismatch and
> **discarded the whole subtree**. The symptom was a data table showing its
> toolbar and its "5 row(s) total" footer with **no rows at all** — which reads
> exactly like a failed fetch, and sent the investigation into the query layer,
> the API client and the error handling before the real cause surfaced in the
> browser console. The data had been correct the entire time.
>
> Timezone needs pinning for the same reason: a server in UTC and a browser in
> PKT disagree even with the locale fixed. Label the zone in the output so a
> pinned time is not silently wrong for whoever reads it.

The same applies to **numbers** — `(1000).toLocaleString()` is `1,000` in en-US
and `1.000` in de-DE.

⚠️ **`Date.now()` in a render is the same class of bug** — the server clock and
the browser clock are never identical, so a relative timestamp ("3m ago")
computed during render mismatches by construction. Compute it in an effect after
mount, or accept the mismatch deliberately with `suppressHydrationWarning`.

### Known violations — fix when touching these files

Three places predate this rule. **Deliberately left unfixed** (demo first) rather
than swept up in an unrelated change. Fix each one when you are next editing that
file for another reason, and tick it off here.

All three sit in `'use client'` components — **which are still server-rendered on
first paint**, so "it's a client component" is not a defence. All three are
latent: not yet observed failing, which is exactly how the extraction bug looked
the day before it cost an afternoon.

- [ ] **`src/features/identities/components/identity-tables/columns.tsx:11`** —
      `Date.now()` inside a cell renderer, computing "3m ago". > ⚠️ **The one most likely to bite next, and the worst to diagnose.** The > other two only mismatch when the host locale differs; this one mismatches > **by construction** — the server clock and the browser clock are never > the same instant, so every render where the rendered string ticks over > (`2m ago` → `3m ago`) is a mismatch. It will present exactly as the > extraction bug did: the Identities table rendering its toolbar and row > count with **no rows**, looking like a failed query. If that happens, > start here, not in the data layer. > Fix: compute after mount in an effect, or `suppressHydrationWarning`.
- [ ] **`src/features/identities/components/person-identities-card.tsx:128`** —
      bare `toLocaleString()` on `linkedAt`; no locale, no timezone.
- [ ] **`src/components/ui/table/data-table-slider-filter.tsx:80`** —
      `toLocaleString(undefined, …)` on a number. Shared component, so this one
      reaches every table with a numeric range filter.

**`src/lib/format-date.ts` is the one implementation** — `formatMeetingDate`,
`formatDateOnly`, `formatDueDate`. Extraction re-exports from it; the tracker
imports it directly. Use it rather than writing another Intl call.

---

## Critical Conventions

- **React Query** for all data fetching — see the SSR pattern above
- **Dates/numbers** — pin the locale AND timezone via `@/lib/format-date`; never `toLocale*(undefined)`, never `Date.now()` in a render. `formatDueDate` takes `now` as a parameter for that reason — resolve it once above the tree
- **Candidate rows are immutable** after extraction — reviewer corrections live on `tracked_item` + `edited_fields`, never written back
- **Cross-feature imports** — key factories and constants may cross a boundary; services, queries and mutations may not
- **AI summaries** — two-gate cache (hash, then TTL), never call the model with zero data, double-label the card, describe work not the worker. See the AI-summaries section
- **`external_task_id` means "mirrors an external system"**, not "was pushed to" — push destinations live on `candidate_action_item`, reached via `tracked_item.candidate_action_item_id`
- **API layer** per feature — `api/types.ts` → `api/service.ts` → `api/queries.ts` → `api/mutations.ts`; queries use key factories; components never import mock APIs directly
- **nuqs** for URL search params — `searchParamsCache` on server, `useQueryStates` on client, `getSortingStateParser` for sort on both
- **Icons** — only import from `@/components/icons`, never from `@tabler/icons-react` directly
- **Forms** — use `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`), never import `<Heading>` manually
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent. Tooling is **oxfmt + oxlint** (`pnpm format`, `pnpm lint`), not Prettier/ESLint
- **LLM calls** — always `complete()` from `@/lib/ai/client`, requested by TIER, never an inline `fetch` and never a slug in feature code
- **The Command Centre is the task system of record** — approved items are native `tracked_item` rows on `/dashboard/tracker`; no external task tool is written to. Slack is the notification surface
- **External reference columns are vendor-neutral and INBOUND only** — `external_task_id` / `external_system` mean "this row mirrors an external system", never "this row was pushed out". Never name a column after a vendor
- **One extraction path** for meetings and Slack. A second one is a design failure
- **Prompt changes** — `pnpm eval:extraction` before and after, every time

## Day-1 notes

- Production Clerk instance will need restricted mode re-enabled — it's per-instance and defaults off
- New teammates join via Users → Invitations, not self-serve sign-up
- Middleware uses deprecated `createRouteMatcher`; new protected routes should use resource-based checks
- `/dashboard/overview` has ~3s artificial delays to strip when you replace it
- `src/app/api/sentry-check/route.ts` is a **temporary** public throw-route for verifying Sentry. Delete it once verified.
- `docs/prd.md` is still missing and is a Day-1 deliverable

## Frontend revamp — mockup is the UI contract

The UI is being rebuilt to match the design mockups. **The mockups define
layout and screens; the amendments define behaviour. Where they conflict,
docs/prd-amendments.md wins** (e.g. mockup "Synced to ClickUp" badges render
as tracker-native state — there is no ClickUp write path).

- **Mockups:** `design/mockup/*.dc.html` — 15 screens across two files,
  located via `data-screen-label` attributes. Open in a browser for visual
  reference; `_ds/` and `support.js` must stay siblings of the HTML.
- **Data contract:** `docs/frontend-data-contract.md` — screen-by-screen
  field requirements. Consult before building any screen or endpoint.
  Contract names map to existing tables via a DTO layer in each feature's
  `api/types.ts` + `service.ts`; DB naming (snake_case, singular) is unchanged.
- **Role-aware nav:** role comes from our `person` table, NOT Clerk orgs.
  Do not reintroduce `NavItem.access` / org-membership RBAC.
- **Screen build rule:** extract the screen's section from the mockup HTML,
  rebuild with existing shadcn components + theme tokens from
  `design/mockup/_ds/_ds_bundle.css`. Enums ship from the backend; colors
  derive in the frontend. Unbuilt data → typed mocks in the feature's
  `api/service.ts` (per the existing "service.ts is the only file that
  changes" pattern) with `// TODO(backend):` markers logged in docs/gaps.md.
