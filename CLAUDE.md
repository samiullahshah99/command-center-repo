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

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Required.** `pk_test_` dev, `pk_live_` prod |
| `CLERK_SECRET_KEY` | **Required.** `sk_test_` dev, `sk_live_` prod |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/auth/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/auth/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | `/dashboard/overview` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | `/dashboard/overview` |

**Do not use `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL`.**
Those names do not exist in `@clerk/nextjs` v7 (verified against 7.6.1) and are
silently ignored — the redirect appears broken with no error.

Env changes do not hot-reload; restart the dev server. `.env*` and `/.clerk/`
are gitignored and must stay that way.

## Critical Conventions

- **React Query** for all data fetching — `void prefetchQuery()` on server + `useSuspenseQuery` on client (standard TanStack pattern), `useMutation` for forms, `HydrationBoundary` + `dehydrate` for hydration, `<Suspense fallback>` for streaming
- **API layer** per feature — `api/types.ts` → `api/service.ts` → `api/queries.ts`; queries use key factories (`entityKeys.all/list/detail`); components import from service and queries, never from mock APIs directly
- **nuqs** for URL search params — `searchParamsCache` on server, `useQueryStates` on client, use `getSortingStateParser` for sort (same parser as `useDataTable`)
- **Icons** — only import from `@/components/icons`, never from `@tabler/icons-react` directly
- **Forms** — use `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`), never import `<Heading>` manually
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent. Tooling is **oxfmt + oxlint** (`bun run format`, `bun run lint`), not Prettier/ESLint
