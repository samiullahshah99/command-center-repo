import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { existsSync } from 'node:fs';

// Define the base Next.js configuration
const baseConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.slingacademy.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'clerk.com',
        port: ''
      }
    ]
  },
  transpilePackages: ['geist'],
  compiler: {
    // Strip console.log/debug in production, but KEEP warn and error.
    //
    // `removeConsole: true` removes ALL console.* calls, which silently deleted
    // every operational diagnostic we had — webhook rejection reasons, duplicate
    // suppression, ingest failures — from the production bundle. Verified by
    // grepping the built output: "ingest failed, returning 500" was present in
    // source and absent from .next/standalone.
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false
  },
  // Internal portal — block indexing at the HTTP layer as well as via
  // robots.ts and the layout metadata. Belt-and-braces: a header covers
  // responses a crawler reaches without parsing HTML (assets, API routes).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet'
          }
        ]
      }
    ];
  }
};

// Sentry is applied ONCE. Previously withSentryConfig wrapped the config twice
// (a conditional wrapper plus an unconditional one on the export), with
// different org/project sources and different sourcemaps settings. Nested
// plugin instances are unsupported and made the effective behaviour depend on
// which wrapper won.
const sentryDisabled = process.env.NEXT_PUBLIC_SENTRY_DISABLED === 'true';

// The Sentry build plugin loads its own dotenv file, so the token may be present
// without ever appearing in process.env.
const hasSentryAuthToken =
  Boolean(process.env.SENTRY_AUTH_TOKEN) || existsSync('.env.sentry-build-plugin');

export default sentryDisabled
  ? baseConfig
  : withSentryConfig(baseConfig, {
      // Env vars win so a different Sentry project can be targeted per
      // environment; the literals are the fallback for this repo.
      org: process.env.NEXT_PUBLIC_SENTRY_ORG ?? 'lucky-fours',
      project: process.env.NEXT_PUBLIC_SENTRY_PROJECT ?? 'command-center',

      // Only print source map upload logs in CI. Locally this hides upload
      // failures entirely -- run `CI=1 pnpm build` to see them.
      silent: !process.env.CI,

      // Upload a larger set of source maps for prettier stack traces
      widenClientFileUpload: true,

      // Route browser requests to Sentry through a Next.js rewrite to
      // circumvent ad-blockers. Must not collide with src/proxy.ts, which
      // matches /dashboard(.*) only.
      tunnelRoute: '/monitoring',

      telemetry: false,

      // Sentry v10: these moved under the webpack namespace
      webpack: {
        reactComponentAnnotation: {
          enabled: true
        },
        automaticVercelMonitors: true,
        treeshake: {
          removeDebugLogging: true
        }
      },

      // Upload needs SENTRY_AUTH_TOKEN. Check the env var AND the plugin's own
      // dotenv file -- locally the token lives only in .env.sentry-build-plugin
      // (gitignored), so an env-only check would wrongly skip upload on every
      // developer machine. In Docker/Railway that file is absent and the token
      // arrives as a build arg instead.
      sourcemaps: {
        disable: !hasSentryAuthToken
      }
    });
