// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// Opt-out flag is a string. Only the literal 'true' disables Sentry — a bare
// `!process.env.NEXT_PUBLIC_SENTRY_DISABLED` check would treat the documented
// default of "false" as truthy and silently switch Sentry off.
const disabled = process.env.NEXT_PUBLIC_SENTRY_DISABLED === 'true';
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!disabled && dsn) {
  Sentry.init({
    dsn,

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Adds request headers and IP for users, for more info visit
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,

    dataCollection: {
      // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
      // userInfo: false,
      // httpBodies: [],
    },

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false
  });
}

// Required by Next.js to instrument App Router navigations for Sentry tracing.
// Must be exported unconditionally — Next.js reads it at module load, before
// any runtime check of whether Sentry was initialised. When init is skipped
// this is a no-op.
//
// oxlint resolves @sentry/nextjs to its Node entry point, which does not export
// this symbol; the browser build (build/esm/index.client.js) does, and tsc
// resolves it correctly via the package's conditional exports. Suppressing the
// resolver false-positive keeps full type-safety, unlike an `as any` cast.
// oxlint-disable-next-line import/namespace
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
