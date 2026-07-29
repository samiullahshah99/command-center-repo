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

**Not yet available — Day 2 work:**

| Command | Status |
| --- | --- |
| `pnpm db:generate` | ❌ Does not exist. Drizzle not installed. |
| `pnpm db:migrate` | ❌ Does not exist. |
| `pnpm db:seed` | ❌ Does not exist. |
| `pnpm db:studio` | ❌ Does not exist. |

`DATABASE_URL` is already set in `.env.local`. The connection string is
provider-agnostic — nothing in the repo assumes Railway, Neon, or Supabase.

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
