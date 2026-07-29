// ⚠️ TODO: DELETE THIS ROUTE ⚠️
//
// Temporary smoke-test endpoint to confirm Sentry receives events from the
// deployed environment. Hit it once, verify the event lands in Sentry, then
// remove this file:
//
//   rm -rf src/app/api/sentry-check
//
// This route is PUBLIC — src/proxy.ts only protects /dashboard/*, so anyone who
// finds the URL can trigger a 500 and consume Sentry event quota. Do not leave
// it deployed.

import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

export function GET() {
  Sentry.logger.info('sentry-check route hit — about to throw');
  throw new Error('sentry-smoke-test');
}
