# Command Center

Internal operations portal. Tracks commitments, role expectations, and recurring
work across the tools the team already uses.

> [!IMPORTANT]
> **This is an internal application, not a public product.** All `/dashboard/*`
> routes require authentication, and search-engine indexing is blocked in three
> places (see [CLAUDE.md](./CLAUDE.md)). It is not a template — do not treat the
> upstream starter's documentation as authoritative for this repo.

Built on [next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
(MIT, © 2023 Kiranism — see [LICENSE](./LICENSE)), then trimmed and extended.

## Status

Week 1, in progress.

**Working**

- Clerk authentication, single-org, invitation-only sign-up
- **People** — team roster with role-profile assignment, search, filtering
- **Role Profiles** — tracked signals, source channels, quota config
- Postgres schema and migrations via Drizzle, with an idempotent seed
- Sentry error tracking across client, server, and edge
- Deployed to Railway from `Dockerfile` (standalone output)

**Not built yet**

- ClickUp / Slack / Fireflies connectors (credentials verified, clients pending)
- Notion client — verified credential only, feeds a later phase
- LLM client at `src/lib/ai/client.ts`
- `tracked_item`, `completion_event`, and `raw_event` have schema but no UI

`/dashboard/product` and `/dashboard/users` are the **upstream template's demo
features**, retained deliberately as the reference implementation for the
data-table and form patterns. They read mock data, not Postgres.

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Language | TypeScript 5.7 |
| Package manager | **pnpm** (pinned via `packageManager`) |
| Database | Postgres 18 + [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [Clerk](https://clerk.com) — authentication only |
| Data fetching | [TanStack Query](https://tanstack.com/query) (SSR prefetch + hydration) |
| URL state | [nuqs](https://nuqs.47ng.com/) |
| Tables | [TanStack Table](https://tanstack.com/table) |
| Forms | [TanStack Form](https://tanstack.com/form) + [Zod](https://zod.dev) |
| UI | [shadcn/ui](https://ui.shadcn.com) on [Base UI](https://base-ui.com), Tailwind CSS v4 |
| Command palette | [kbar](https://kbar.vercel.app/) |
| Errors | [Sentry](https://sentry.io) |
| Lint / format | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs) — **not** ESLint/Prettier |
| LLM access | [OpenRouter](https://openrouter.ai) |
| Hosting | [Railway](https://railway.app) |

## Getting started

Requires Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env.local     # then fill in the values
pnpm dev
```

Runs at http://localhost:3000.

### Required environment variables

Without the first two, every `/dashboard/*` route returns 500 with
`@clerk/backend: Missing publishableKey`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **Required** |
| `CLERK_SECRET_KEY` | **Required** |
| `DATABASE_URL` | Required for People / Role Profiles |

`.env.example` documents every variable the project uses, grouped by service.
Env changes are **not** hot-reloaded — restart the dev server.

> [!WARNING]
> Do not use `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `AFTER_SIGN_UP_URL`. Those
> names do not exist in `@clerk/nextjs` v7 and are silently ignored. Use the
> `FALLBACK_REDIRECT_URL` names in `.env.example`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` / `lint:fix` / `lint:strict` | oxlint |
| `pnpm format` / `format:check` | oxfmt |
| `pnpm db:generate` | Emit a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | Seed role profiles, roster, recurring tasks (idempotent) |
| `pnpm verify:notion` | Read-only Notion credential check |
| `CI=1 pnpm build` | Build with Sentry source-map upload logs visible |

`pnpm db:push` also exists but applies schema changes **without a migration
file** — development only, never against production.

## Database

Two connection strings, deliberately:

| Variable | Used by | Points at |
| --- | --- | --- |
| `DATABASE_URL` | the running app | `postgres.railway.internal` in Railway — keeps queries on the private network |
| `DATABASE_PUBLIC_URL` | migrations | the public proxy host — `drizzle-kit` runs from a laptop or CI and cannot reach `*.railway.internal` |

`drizzle.config.ts` falls back to `DATABASE_URL` when `DATABASE_PUBLIC_URL` is
unset, so a local single-URL setup works unchanged.

**Migrations are run manually**, not by a deploy hook:

```bash
pnpm db:generate    # review the SQL in drizzle/ first
pnpm db:migrate
```

The tradeoff is real — schema and deployed code can drift if you forget. See
[CLAUDE.md](./CLAUDE.md) for why that was chosen over a Railway pre-deploy hook.

Six tables: `person`, `role_profile`, `tracked_item`, `recurring_task`,
`completion_event`, `raw_event`. Names are snake_case and singular.

> [!IMPORTANT]
> **ClickUp is the system of record for tasks.** `tracked_item` holds a
> `clickup_task_id` reference plus our own state. It must not duplicate ClickUp
> task data — no title, assignee, status, or comments.

## Project structure

```plaintext
src/
├── app/
│   ├── auth/                   # Clerk sign-in / sign-up
│   ├── dashboard/
│   │   ├── overview/           # Analytics (parallel routes)
│   │   ├── people/             # People admin (Postgres)
│   │   ├── role-profiles/      # Role Profiles admin (Postgres)
│   │   ├── product/            # Template reference feature (mock data)
│   │   ├── users/              # Template reference feature (mock data)
│   │   └── profile/            # Clerk account management
│   ├── api/                    # Route handlers (mock API + Sentry check)
│   ├── robots.ts               # noindex — do not remove
│   └── layout.tsx
│
├── db/                         # Drizzle
│   ├── index.ts                # Lazy pool + client
│   ├── schema/                 # One file per table + Zod validators
│   └── seed.ts
│
├── features/                   # One folder per feature
│   ├── people/                 # api/ components/ constants/ schemas/
│   ├── role-profiles/
│   ├── products/ users/        # reference implementations
│   ├── overview/ auth/ profile/
│
├── components/                 # ui/ layout/ themes/ kbar/ icons.tsx
├── config/  hooks/  lib/  styles/  types/
└── proxy.ts                    # Next.js 16 middleware — Clerk route protection

drizzle/                        # Generated SQL migrations
scripts/                        # Standalone utilities (verify-notion.ts)
docs/                           # Setup + access-status notes
```

New features replicate the shape of `src/features/products/` — see
[CLAUDE.md](./CLAUDE.md#architecture-invariants) for the anatomy and the
TanStack Query SSR pattern.

## Deployment

Deployed on Railway from the `Dockerfile` (Node 22 + pnpm via corepack,
`output: 'standalone'`, non-root user).

`NEXT_PUBLIC_*` values are **inlined into the client bundle at build time**, so
they must be passed as build args — setting them only as runtime variables has
no effect. The Dockerfile declares the ones it needs as `ARG`.

Build and run locally:

```bash
docker build \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx \
  -t command-center .

docker run -d -p 3000:3000 \
  -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx \
  -e CLERK_SECRET_KEY=sk_live_xxxxx \
  -e DATABASE_URL=postgresql://... \
  --restart unless-stopped --name command-center \
  command-center
```

## Documentation

| File | Contents |
| --- | --- |
| **[CLAUDE.md](./CLAUDE.md)** | Invariants and gotchas — read this first |
| [AGENTS.md](./AGENTS.md) | Deep reference: stack, structure, code style, theming, troubleshooting |
| [docs/access-status.md](./docs/access-status.md) | Integration credential status |
| [docs/clerk_setup.md](./docs/clerk_setup.md) | Clerk configuration |
| [docs/forms.md](./docs/forms.md) | Form system |
| [docs/themes.md](./docs/themes.md) | Theme system |

## Conventions

- **Icons** — import only from `@/components/icons`, never `@tabler/icons-react`
- **Forms** — `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — use `PageContainer` props, never import `<Heading>`
- **Zod** — schemas derive from the Drizzle table definitions; do not write parallel validators
- **Formatting** — single quotes, no trailing comma, 2-space indent, enforced by oxfmt

## Notes

- New protected routes should do resource-based auth checks (`auth()` + `redirect()`)
  rather than relying on `src/proxy.ts` — `createRouteMatcher` is deprecated by Clerk.
- `/dashboard/overview` still has ~3s artificial delays from the template.
- `src/app/api/sentry-check/route.ts` is a temporary public throw-route for
  verifying Sentry. Delete it once verified.
