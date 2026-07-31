import { signBodyOnly, verifyBodyOnly, type HmacVerifyResult } from '../verify-hmac';

/**
 * ClickUp webhook signature verification.
 * https://developer.clickup.com/docs/webhooksignature
 *
 *   header     X-Signature
 *   prefix     (none)
 *   basestring rawBody only
 *   replay     ❌ NONE
 *
 * ⚠️ NO REPLAY PROTECTION. ClickUp sends no timestamp, so a captured request
 * stays valid forever and can be replayed verbatim. Idempotency on
 * history_items[0].id is the ONLY defence.
 *
 * ⚠️ The secret is the one returned when the WEBHOOK IS CREATED
 * (CLICKUP_WEBHOOK_SECRET), NOT CLICKUP_API_TOKEN. Different values.
 */

export const CLICKUP_SIGNATURE_HEADER = 'x-signature';

export type ClickUpVerifyResult = HmacVerifyResult;

export function verifyClickUpRequest(input: {
  rawBody: string;
  headers: Headers;
}): ClickUpVerifyResult {
  return verifyBodyOnly({
    headerName: CLICKUP_SIGNATURE_HEADER,
    prefix: '',
    secret: process.env.CLICKUP_WEBHOOK_SECRET,
    rawBody: input.rawBody,
    headers: input.headers
  });
}

/** Test/util helper: sign the way ClickUp does. */
export function signClickUpRequest(input: { rawBody: string; webhookSecret: string }): string {
  return signBodyOnly({ rawBody: input.rawBody, secret: input.webhookSecret, prefix: '' });
}
