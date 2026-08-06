/**
 * Thrown by a `'use server'` service when the caller's ROLE does not permit the
 * data it returns.
 *
 * ⚠️ DISTINCT FROM "not authenticated", deliberately. `requireUser()` answers
 * "is anyone there?"; this answers "is it allowed to be you?". Collapsing them
 * into one generic `Error` makes a genuine authorisation denial indistinguishable
 * from an expired session in Sentry, and the two want opposite responses — one is
 * "sign in again", the other is "you will never be able to see this".
 *
 * ⚠️ THIS IS DEFENCE IN DEPTH, NOT THE UX. A user should never see it: the page
 * guard (`requireRouteAccess`) redirects them to their own home first. Reaching
 * this means the Server Action was called directly — which is exactly the hole
 * the page guard alone cannot close, because a Server Action is its own POST
 * endpoint that the route matcher does not cover.
 *
 * ⚠️ Client-safe: a plain Error subclass, no imports. A client component may
 * `instanceof` it when handling a mutation rejection.
 */
export class AuthorizationError extends Error {
  /** Stable discriminator — `instanceof` does not survive the RSC boundary. */
  readonly code = 'FORBIDDEN' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * ⚠️ `instanceof` is unreliable across the Server Action boundary: the error is
 * serialised and re-thrown, so a client catch sees a plain object. Check the
 * discriminator instead.
 */
export function isAuthorizationError(e: unknown): boolean {
  return (
    e instanceof AuthorizationError ||
    (typeof e === 'object' && e !== null && 'code' in e && e.code === 'FORBIDDEN')
  );
}
