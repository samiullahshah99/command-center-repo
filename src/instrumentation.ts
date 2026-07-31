import * as Sentry from '@sentry/nextjs';

const sentryOptions: Sentry.NodeOptions | Sentry.EdgeOptions = {
  // Sentry DSN
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Enable Spotlight in development
  spotlight: process.env.NODE_ENV === 'development',

  // Adds request headers and IP for users, for more info visit
  sendDefaultPii: true,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false
};

export async function register() {
  // Fire-and-forget: see the note on startQueueWorkers().
  void startQueueWorkers();

  // Opt-out flag is a string. Only the literal 'true' disables Sentry — a bare
  // `!process.env.NEXT_PUBLIC_SENTRY_DISABLED` check treats the documented
  // default of "false" as truthy and silently switches Sentry off.
  if (process.env.NEXT_PUBLIC_SENTRY_DISABLED !== 'true') {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      // Node.js Sentry configuration
      Sentry.init(sentryOptions);
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      // Edge Sentry configuration
      Sentry.init(sentryOptions);
    }
  }
}

/**
 * Queue workers.
 *
 * register() runs ONCE per server process, at boot, before requests are served —
 * verified empirically on a standalone build (one invocation, `nodejs` runtime
 * only). The edge runtime never reached it even with middleware active, but the
 * guard stays because the docs say register is called in all environments.
 *
 * ⚠️ NOT awaited. The docs state register() must complete before the server is
 * ready, so awaiting a queue connection would let a bad DATABASE_URL block the
 * container from serving ANY request, including health checks. Workers start in
 * the background; a failure is logged and the web tier stays up.
 */
async function startQueueWorkers() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.QUEUE_WORKERS_ENABLED === 'false') {
    console.warn('[queue] workers disabled via QUEUE_WORKERS_ENABLED=false');
    return;
  }

  try {
    const { startWorkers } = await import('./lib/queue/start-workers');
    await startWorkers();
  } catch (err) {
    console.error(
      '[queue] failed to start workers — the web server is still serving:',
      err instanceof Error ? err.message : err
    );
  }
}

export const onRequestError = Sentry.captureRequestError;
