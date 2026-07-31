/**
 * Send a correctly-signed dummy webhook to our own endpoints, so delivery can be
 * verified without waiting on the sender.
 *
 *   pnpm tsx scripts/send-test-webhook.ts <ugc|vision|slack|clickup|fireflies> [flags]
 *
 * Flags
 *   --local          POST to http://localhost:3000   (DEFAULT — never prod by accident)
 *   --prod           POST to the Railway deployment
 *   --duplicate      reuse the previous run's id, to prove dedupe suppresses it
 *   --tamper         sign correctly, then alter one byte — must be rejected 401
 *   --fixture=NAME   use fixtures/<source>/NAME instead of the source's default
 *
 * fireflies only
 *   --meeting-id=ID          send a REAL meeting id, used verbatim (not randomised)
 *   --event=NAME             override the `event` value
 *   --signature-header=NAME  sign under a different header, to probe which one v2 uses
 *
 * ── Why it imports the handlers' own signing helpers ────────────────────────
 * Each source signs differently, and a local reimplementation would drift the
 * moment a scheme changed — this script would then "prove" delivery worked while
 * production 401'd everything. So it calls signSlackRequest / signClickUpRequest /
 * signWithTimestamp / signBodyOnly, the same functions the route tests use, with
 * header names and prefixes imported from the contract module rather than retyped.
 *
 * ── Why fixtures rather than hand-built objects ─────────────────────────────
 * The bodies are the real fixtures under fixtures/<source>/, so this script and
 * the test suite exercise the same payloads and cannot describe different
 * contracts.
 *
 * Secrets are read from .env.local. Nothing here prints a secret, a signature,
 * or a request body.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvLocal } from './clickup/shared';
import { signBodyOnly, signWithTimestamp } from '../src/features/connectors/verify-hmac';
import {
  SLACK_SIGNATURE_HEADER,
  SLACK_TIMESTAMP_HEADER,
  signSlackRequest
} from '../src/features/connectors/slack/verify';
import {
  CLICKUP_SIGNATURE_HEADER,
  signClickUpRequest
} from '../src/features/connectors/clickup/verify';
import {
  FIREFLIES_DELIVERY_ID_HEADER,
  FIREFLIES_SIGNATURE_HEADER,
  isFirefliesTestEvent,
  signFirefliesRequest
} from '../src/features/connectors/fireflies';
import {
  isTestEvent,
  UGC_EVENT_HEADER,
  UGC_EVENT_ID_HEADER,
  UGC_SEPARATOR,
  UGC_SIGNATURE_HEADER,
  UGC_SIGNATURE_PREFIX,
  UGC_TIMESTAMP_HEADER,
  VISION_DELIVERY_HEADER,
  VISION_EVENT_HEADER,
  VISION_SIGNATURE_HEADER,
  VISION_SIGNATURE_PREFIX
} from '../src/features/connectors/internal/contract';

loadEnvLocal();

// ── Targets ─────────────────────────────────────────────────────────────────

const LOCAL_BASE = 'http://localhost:3000';
const PROD_BASE = 'https://command-center-repo-production.up.railway.app';

type Source = 'ugc' | 'vision' | 'slack' | 'clickup' | 'fireflies';
const SOURCES: Source[] = ['ugc', 'vision', 'slack', 'clickup', 'fireflies'];

type Payload = Record<string, unknown>;

/**
 * Set from --signature-header=. Exists to probe WHICH header Fireflies v2 really
 * uses: the handler currently reads the v1 name and the v2 name has never been
 * observed, because every delivery so far arrived unsigned.
 */
let SIGNATURE_HEADER_OVERRIDE: string | null = null;

type SourceConfig = {
  /** Default fixture under fixtures/<source>/. */
  fixture: string;
  secretEnvVar: string;
  /** Overwrite the idempotency key in place — must be the field the handler reads. */
  setExternalId: (payload: Payload, id: string) => void;
  /** Headers computed over the EXACT bytes being sent. */
  headers: (input: { rawBody: string; secret: string; payload: Payload }) => Record<string, string>;
  /**
   * The value the handler will store as `external_id`, when it is not simply the
   * id written by setExternalId. Fireflies keys on the COMPOSITE
   * `event:meeting_id`, so the row cannot be found by meeting id alone.
   */
  lookupIdFor?: (payload: Payload) => string;
  /**
   * UGC and Vision only. Their handlers store test pings with a NULL
   * external_id on purpose, so that repeated pings during setup all land as
   * separate rows instead of being deduped into invisibility. Looking such a row
   * up by id therefore finds nothing, which is correct and not a delivery
   * failure — the script has to know the difference before it reports one.
   */
  isTestPayload?: (payload: Payload) => boolean;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

const CONFIG: Record<Source, SourceConfig> = {
  ugc: {
    fixture: 'creator-approved.json',
    secretEnvVar: 'UGC_WEBHOOK_SECRET',
    setExternalId: (p, id) => {
      p.id = id;
    },
    headers: ({ rawBody, secret, payload }) => {
      // Basestring is `{timestamp}.{body}` — a DOT, not Slack's colon.
      const { signature, timestamp } = signWithTimestamp({
        rawBody,
        timestamp: nowSeconds(),
        secret,
        prefix: UGC_SIGNATURE_PREFIX,
        separator: UGC_SEPARATOR,
        format: 'plain'
      });
      return {
        'Content-Type': 'application/json',
        [UGC_SIGNATURE_HEADER]: signature,
        [UGC_TIMESTAMP_HEADER]: timestamp,
        [UGC_EVENT_ID_HEADER]: String(payload.id ?? ''),
        // ⚠️ UGC names the event field `type`. Vision names it `event`.
        [UGC_EVENT_HEADER]: String(payload.type ?? '')
      };
    },
    isTestPayload: (p) => isTestEvent('ugc', p, typeof p.type === 'string' ? p.type : null)
  },

  vision: {
    fixture: 'brief-submitted.json',
    secretEnvVar: 'VISION_WEBHOOK_SECRET',
    setExternalId: (p, id) => {
      p.id = id;
    },
    headers: ({ rawBody, secret, payload }) => ({
      'Content-Type': 'application/json',
      // Body alone — no timestamp, so no replay window.
      [VISION_SIGNATURE_HEADER]: signBodyOnly({ rawBody, secret, prefix: VISION_SIGNATURE_PREFIX }),
      [VISION_DELIVERY_HEADER]: String(payload.id ?? ''),
      [VISION_EVENT_HEADER]: String(payload.event ?? '')
    }),
    isTestPayload: (p) => isTestEvent('vision', p, typeof p.event === 'string' ? p.event : null)
  },

  slack: {
    fixture: 'message-channels.json',
    secretEnvVar: 'SLACK_SIGNING_SECRET',
    // Slack's idempotency key is the envelope's event_id, not event.ts.
    setExternalId: (p, id) => {
      p.event_id = id;
    },
    headers: ({ rawBody, secret }) => {
      const { signature, timestamp } = signSlackRequest({
        rawBody,
        timestamp: nowSeconds(),
        signingSecret: secret
      });
      return {
        'Content-Type': 'application/json',
        [SLACK_SIGNATURE_HEADER]: signature,
        [SLACK_TIMESTAMP_HEADER]: timestamp
      };
    }
  },

  clickup: {
    fixture: 'task-created.json',
    secretEnvVar: 'CLICKUP_WEBHOOK_SECRET',
    // history_items[0].id — NEVER webhook_id, which is identical on every
    // delivery and would dedupe away every event after the first.
    setExternalId: (p, id) => {
      const items = p.history_items;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('fixture has no history_items — ClickUp dedupe key is history_items[0].id');
      }
      (items[0] as Payload).id = id;
    },
    headers: ({ rawBody, secret }) => ({
      'Content-Type': 'application/json',
      // No prefix, no timestamp.
      [CLICKUP_SIGNATURE_HEADER]: signClickUpRequest({ rawBody, webhookSecret: secret })
    })
  },

  fireflies: {
    fixture: 'webhook-transcription-completed.json',
    secretEnvVar: 'FIREFLIES_WEBHOOK_SECRET',
    // v2 is snake_case. --meeting-id overrides this before we get here; the
    // generated id is only the fallback for a throwaway run.
    setExternalId: (p, id) => {
      p.meeting_id = id;
    },
    // ⚠️ The handler keys on the COMPOSITE event:meeting_id, not meeting_id
    // alone, so the post-send row lookup has to build the same string or it
    // would report "accepted but not persisted" for a row that is right there.
    lookupIdFor: (p) => `${String(p.event)}:${String(p.meeting_id)}`,
    headers: ({ rawBody, secret, payload }) => ({
      'Content-Type': 'application/json',
      // ⚠️ SIGNED WITH THE HEADER THE HANDLER ACTUALLY READS, which today is the
      // v1 name `x-hub-signature`. Override with --signature-header=<name> to
      // probe the v2 hypothesis (x-webhook-signature) — the handler will 401 it
      // until FIREFLIES_SIGNATURE_HEADER changes to match. See the note in
      // features/connectors/fireflies/index.ts.
      [SIGNATURE_HEADER_OVERRIDE ?? FIREFLIES_SIGNATURE_HEADER]: signFirefliesRequest({
        rawBody,
        secret
      }),
      // Sent for realism: this is the one v2 header we have actually observed.
      // Deliberately NOT `test-` prefixed — that would trip the unsigned-test
      // exception and skip the transcript fetch entirely.
      [FIREFLIES_DELIVERY_ID_HEADER]: `dlv-${randomUUID()}`,
      'User-Agent': 'Fireflies-Webhook/2.0'
    }),
    isTestPayload: (p) =>
      typeof p.event === 'string' &&
      typeof p.meeting_id === 'string' &&
      isFirefliesTestEvent({ event: p.event, meeting_id: p.meeting_id })
  }
};

// ── --duplicate state ───────────────────────────────────────────────────────
// Recording the raw_event id too turns --duplicate into a real assertion: the
// same row must come back, proving nothing new was inserted.

const STATE_FILE = join(tmpdir(), 'command-center-last-test-webhook.json');
type LastRun = {
  /** The key the handler stores — a composite for Fireflies. Used for the lookup. */
  externalId: string;
  /**
   * The id actually written INTO the body. Same as externalId for every source
   * except Fireflies, whose stored key is `event:meeting_id` while the body
   * field holds meeting_id alone. --duplicate must replay the body value, not
   * the composite, or it would write "Meeting Transcribed:abc" into meeting_id.
   */
  bodyId?: string;
  rawEventId?: string | null;
};

function readState(): Record<string, LastRun> {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, LastRun>;
  } catch {
    return {};
  }
}

function writeState(source: Source, run: LastRun): void {
  const state = readState();
  state[source] = run;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage(message?: string): never {
  if (message) console.error(`\n  ❌ ${message}`);
  console.error(`
  Usage: pnpm tsx scripts/send-test-webhook.ts <${SOURCES.join('|')}> [flags]

    --local          POST to ${LOCAL_BASE}  (default)
    --prod           POST to ${PROD_BASE}
    --duplicate      reuse the previous id, to prove dedupe suppresses it
    --tamper         sign correctly then alter one byte — expect 401
    --fixture=NAME   use fixtures/<source>/NAME

  fireflies only:
    --meeting-id=ID          real meeting id, used verbatim
    --event=NAME             override the event value
    --signature-header=NAME  probe a different signature header
`);
  process.exit(1);
}

const KNOWN_FLAGS = ['--local', '--prod', '--duplicate', '--tamper'];
const VALUE_FLAGS = ['--fixture=', '--meeting-id=', '--event=', '--signature-header='];

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const source = positional[0] as Source | undefined;

  if (!source) usage('No source given.');
  if (!SOURCES.includes(source)) usage(`Unknown source "${source}".`);
  if (positional.length > 1) usage(`Unexpected argument "${positional[1]}".`);

  const unknown = args.filter(
    (a) =>
      a.startsWith('--') &&
      !KNOWN_FLAGS.includes(a) &&
      !VALUE_FLAGS.some((f) => a.startsWith(f))
  );
  if (unknown.length > 0) usage(`Unknown flag "${unknown[0]}".`);

  const isProd = args.includes('--prod');
  const duplicate = args.includes('--duplicate');
  const tamper = args.includes('--tamper');
  const valueOf = (flag: string) =>
    args.find((a) => a.startsWith(flag))?.slice(flag.length) || undefined;

  const fixtureArg = valueOf('--fixture=');
  const meetingIdArg = valueOf('--meeting-id=');
  const eventArg = valueOf('--event=');
  SIGNATURE_HEADER_OVERRIDE = valueOf('--signature-header=')?.toLowerCase() ?? null;

  if ((meetingIdArg || eventArg || SIGNATURE_HEADER_OVERRIDE) && source !== 'fireflies') {
    usage('--meeting-id, --event and --signature-header apply to `fireflies` only.');
  }

  const cfg = CONFIG[source];
  const url = `${isProd ? PROD_BASE : LOCAL_BASE}/api/webhooks/${source}`;

  const secret = process.env[cfg.secretEnvVar];
  if (!secret) {
    console.error(`\n  ❌ ${cfg.secretEnvVar} is not set in .env.local.`);
    console.error('     Without it no valid signature can be built and the endpoint will 401.');
    return 1;
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  const fixtureName = fixtureArg ?? cfg.fixture;
  const fixturePath = join(process.cwd(), 'fixtures', source, fixtureName);
  if (!existsSync(fixturePath)) usage(`No fixture at fixtures/${source}/${fixtureName}`);

  const payload = JSON.parse(readFileSync(fixturePath, 'utf8')) as Payload;
  const isTest = cfg.isTestPayload?.(payload) ?? false;

  const previous = readState()[source];
  if (duplicate && !previous) {
    console.error('\n  ❌ --duplicate given but no previous run is recorded for this source.');
    console.error('     Send one without --duplicate first.');
    return 1;
  }
  if (duplicate && isTest) {
    console.error('\n  ❌ --duplicate cannot prove anything with a test-event fixture.');
    console.error('     Test pings are stored with a NULL external_id by design, so dedupe');
    console.error('     never applies to them. Use a non-test fixture.');
    return 1;
  }

  // ⚠️ --meeting-id is used VERBATIM, never randomised. The whole point of
  // passing a real meeting is that the worker fetches THAT transcript; a fresh
  // uuid would make the GraphQL query 404. The cost is that dedupe now applies
  // normally, so a second identical run is suppressed — vary --event, or delete
  // the row, to send it again.
  if (eventArg !== undefined) payload.event = eventArg;

  const bodyId =
    meetingIdArg ?? (duplicate ? (previous.bodyId ?? previous.externalId) : `test-${randomUUID()}`);
  cfg.setExternalId(payload, bodyId);

  // The key the HANDLER will store, which for Fireflies is a composite and so
  // differs from what setExternalId just wrote into the body.
  const externalId = cfg.lookupIdFor ? cfg.lookupIdFor(payload) : bodyId;

  // ⚠️ SERIALISE ONCE. These exact bytes are what gets signed AND what gets sent.
  // Re-serialising after signing changes the bytes, the HMAC stops matching, and
  // the failure is indistinguishable from a wrong secret.
  const rawBody = JSON.stringify(payload);
  const headers = cfg.headers({ rawBody, secret, payload });

  // --tamper mutates the body AFTER signing, leaving a signature valid for the
  // original bytes. Flipping a character of the id keeps the JSON parseable, so
  // a 200 here would mean verification was skipped — not that parsing failed.
  //
  // ⚠️ Flip a character of bodyId, NOT externalId. They are the same string for
  // every source except Fireflies, whose externalId is the composite
  // `event:meeting_id` and appears nowhere in the body — replace() would match
  // nothing and the "tampered" request would be byte-identical to the signed one.
  let bodyToSend = rawBody;
  if (tamper) {
    const flipped = bodyId.slice(0, -1) + (bodyId.endsWith('a') ? 'b' : 'a');
    bodyToSend = rawBody.replace(bodyId, flipped);
    if (bodyToSend === rawBody) {
      console.error('  ❌ could not alter the body — refusing to send a validly signed request');
      return 1;
    }
  }

  console.log(`\n  source     ${source}`);
  console.log(`  target     ${url}${isProd ? '   ⚠️  PRODUCTION' : ''}`);
  console.log(`  fixture    fixtures/${source}/${fixtureName}`);
  console.log(`  id         ${bodyId}${duplicate ? '   (reused — expecting dedupe)' : ''}`);
  if (externalId !== bodyId) console.log(`  stored key ${externalId}   (composite)`);
  console.log(`  secret     ${cfg.secretEnvVar}  (set, ${secret.length} chars, not printed)`);
  console.log(`  headers    ${Object.keys(headers).join(', ')}`);
  if (tamper) console.log('  mode       ⚠️  TAMPERED after signing — expecting 401');
  console.log('');

  // ── Send ──────────────────────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyToSend,
      signal: AbortSignal.timeout(30_000)
    });
  } catch (err) {
    console.error(`  ❌ request failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!isProd) console.error('     Is the dev server up? pnpm dev');
    return 1;
  }

  const text = await res.text();
  const expected = tamper ? 401 : 200;
  const statusOk = res.status === expected;

  console.log(`  ${statusOk ? '✅' : '❌'} HTTP ${res.status}   (expected ${expected})`);
  console.log(
    `  body       ${text === '' ? '(empty — handlers answer 200 with no body)' : text.slice(0, 500)}`
  );

  // The handlers answer `new Response(null, { status: 200 })`, so there is no
  // raw_event id in the response to print. Look it up instead — that is what
  // distinguishes "accepted" from "actually persisted".
  let rawEventId: string | null = null;
  if (!tamper && res.status === 200) {
    if (isTest) {
      console.log('  raw_event  (test event — stored with a NULL external_id by design,');
      console.log('              so it cannot be looked up by id. Check the table directly.)');
    } else {
      rawEventId = await reportStoredRow(source, externalId, duplicate, previous);
    }
  }

  if (!tamper && res.status === 200 && !duplicate) {
    writeState(source, { externalId, bodyId, rawEventId });
  }

  return statusOk ? 0 : 1;
}

async function reportStoredRow(
  source: Source,
  externalId: string,
  duplicate: boolean,
  previous: LastRun | undefined
): Promise<string | null> {
  if (!process.env.DATABASE_URL) {
    console.log('  raw_event  (DATABASE_URL not set — skipping the persistence check)');
    return null;
  }

  let connected = false;
  try {
    const { findRawEventByExternalId } = await import('../src/features/connectors/ingest');
    connected = true;
    const row = await findRawEventByExternalId(source, externalId);

    if (!row) {
      console.log('  raw_event  ⚠️  no row found — accepted but not persisted');
      return null;
    }

    console.log(
      `  raw_event  ${row.id}  received_at=${row.receivedAt.toISOString()}  processed=${row.processed}`
    );

    if (duplicate) {
      const same = previous?.rawEventId != null && previous.rawEventId === row.id;
      console.log(
        same
          ? '  ✅ dedupe   same row as the first send — no duplicate inserted'
          : '  ⚠️  dedupe   row id differs from the first send; check the idempotency key'
      );
    }

    return row.id;
  } catch (err) {
    console.log(`  raw_event  (lookup failed: ${err instanceof Error ? err.message : String(err)})`);
    return null;
  } finally {
    if (connected) {
      // The pool is lazy, so this only closes something if a query ran.
      const { pool } = await import('../src/db');
      await pool.end().catch(() => {});
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
