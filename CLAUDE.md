# CLAUDE.md

This is a Next.js 16 + shadcn/ui admin dashboard starter kit.

## Key References

- **[AGENTS.md](./AGENTS.md)** — Full project overview, tech stack, structure, conventions, data fetching patterns, deployment
- **[docs/forms.md](./docs/forms.md)** — Form system: TanStack Form + Zod, composable fields, validation, multi-step, sheet/dialog forms
- **[docs/themes.md](./docs/themes.md)** — Theme system: OKLCH colors, adding themes, font config
- **[docs/clerk_setup.md](./docs/clerk_setup.md)** — Clerk auth setup: environment variables, sign-in/sign-up

## Removed from this template

Clerk Organizations (multi-tenant workspaces/teams), Clerk Billing/subscriptions,
navigation RBAC (it was powered by org membership), and the Kanban, Chat,
Notifications, Forms-demo, React Query demo, and Icons pages. **Clerk auth is
still in use.** Do not reintroduce `useOrganization`, `<Protect>`, `has({ plan })`,
`PricingTable`, or `NavItem.access`.

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

### Required env vars to boot

Copy `env.example.txt` to `.env.local`. Without the first two, every
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
> `baseConfig`, which is then wrapped twice by `withSentryConfig` — anyone
> restructuring that file can drop it without any test failing. Nothing in the
> build catches its absence. If you touch `next.config.ts`, verify
> `curl -I localhost:3000 | grep -i x-robots-tag` still returns the header.
>
> Do **not** re-add `public/robots.txt`. A static file in `public/` silently
> takes precedence over `src/app/robots.ts`. The one that used to live there
> disallowed only four paths and implicitly allowed everything else.

These are crawler *requests*, not access control. Actual protection is Clerk on
`/dashboard/*` via `src/proxy.ts`.

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

## Critical Conventions

- **React Query** for all data fetching — `void prefetchQuery()` on server + `useSuspenseQuery` on client (standard TanStack pattern), `useMutation` for forms, `HydrationBoundary` + `dehydrate` for hydration, `<Suspense fallback>` for streaming
- **API layer** per feature — `api/types.ts` → `api/service.ts` → `api/queries.ts`; queries use key factories (`entityKeys.all/list/detail`); components import from service and queries, never from mock APIs directly
- **nuqs** for URL search params — `searchParamsCache` on server, `useQueryStates` on client, use `getSortingStateParser` for sort (same parser as `useDataTable`)
- **Icons** — only import from `@/components/icons`, never from `@tabler/icons-react` directly
- **Forms** — use `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`), never import `<Heading>` manually
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent. Tooling is **oxfmt + oxlint** (`bun run format`, `bun run lint`), not Prettier/ESLint

## Day-1 notes

- Production Clerk instance will need restricted mode re-enabled — it's per-instance and defaults off
- New teammates join via Users → Invitations, not self-serve sign-up
- Middleware uses deprecated createRouteMatcher; new protected routes should use resource-based checks
- /dashboard/overview has ~3s artificial delays to strip when you replace it
