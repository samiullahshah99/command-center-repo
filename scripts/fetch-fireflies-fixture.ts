/**
 * Capture a real Fireflies transcript as a SCRUBBED replay fixture.
 *
 *   pnpm tsx scripts/fetch-fireflies-fixture.ts <meetingId> [--out=NAME] [--keep-sentences=N]
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The Week 1 exit test has to replay a real transcript through the worker, and a
 * hand-written fixture would only prove the pipeline handles a shape we invented.
 * This captures the genuine response so the test exercises the real contract.
 *
 * ⚠️ THIS REPO IS PUBLIC. The live response contains real names, real work email
 * addresses and 57 minutes of real conversation. Everything identifying is
 * replaced before anything is written to disk — see scrub(). We have already had
 * to remove real addresses from the ClickUp fixtures once; this does it up front
 * rather than relying on someone remembering.
 *
 * What is preserved: the STRUCTURE — every field name, nesting level, id format
 * and speaker/sentence relationship — because that is what the fixture is for.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvLocal } from './clickup/shared';

loadEnvLocal();

/** Speaker A, B, C … then AA, AB for the improbable case of >26 speakers. */
function alias(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Speaker ${out}`;
}

type Scrubber = {
  speakerName: (real: string) => string;
  email: (real: string) => string;
  /** Every substitution made, so a human can review what left the building. */
  report: () => { speakers: [string, string][]; emails: [string, string][] };
};

function makeScrubber(): Scrubber {
  const speakers = new Map<string, string>();
  const emails = new Map<string, string>();

  return {
    speakerName(real) {
      if (!speakers.has(real)) speakers.set(real, alias(speakers.size));
      return speakers.get(real)!;
    },
    email(real) {
      // example.com is reserved by RFC 2606 and can never be a real mailbox.
      if (!emails.has(real)) emails.set(real, `speaker${emails.size + 1}@example.com`);
      return emails.get(real)!;
    },
    report: () => ({ speakers: [...speakers], emails: [...emails] })
  };
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Replace every identifying value, everywhere, including inside free text.
 *
 * Sentence text is the hard part: a 57-minute conversation says people's names
 * out loud. Every known speaker name is substituted throughout the transcript
 * body, not just in the `speakers` array.
 */
function scrub(value: unknown, s: Scrubber, knownNames: string[]): unknown {
  if (typeof value === 'string') {
    let out = value.replace(EMAIL_RE, (m) => s.email(m.toLowerCase()));
    for (const name of knownNames) {
      // Whole-word, case-insensitive. Longest names first (handled by the
      // caller's sort) so "Sami Ullah Shah" is replaced before "Sami".
      out = out.replace(new RegExp(escapeRe(name), 'gi'), s.speakerName(name));
      const [first] = name.split(/\s+/);
      if (first && first.length > 2) {
        out = out.replace(new RegExp(`\\b${escapeRe(first)}\\b`, 'gi'), s.speakerName(name));
      }
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, s, knownNames));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v, s, knownNames)])
    );
  }
  return value;
}

function escapeRe(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const meetingId = args.find((a) => !a.startsWith('--'));
  if (!meetingId) {
    console.error(`
  Usage: pnpm tsx scripts/fetch-fireflies-fixture.ts <meetingId> [--out=NAME] [--keep-sentences=N]

    --out=NAME            fixture filename (default replay-transcript.json)
    --keep-sentences=N    trim to the first N sentences (default 12)
`);
    return 1;
  }

  const outName =
    args.find((a) => a.startsWith('--out='))?.slice('--out='.length) ??
    'replay-transcript.json';
  const keep = Number(
    args.find((a) => a.startsWith('--keep-sentences='))?.slice('--keep-sentences='.length) ?? 12
  );

  const { getTranscript } = await import('../src/features/connectors/fireflies/client');

  console.log(`\n  fetching ${meetingId}…`);
  let transcript;
  try {
    transcript = await getTranscript(meetingId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ❌ ${msg}`);
    if (/paid plan/i.test(msg)) {
      console.error(`
     A paid-plan error here means a REQUESTED FIELD is gated, not that the API
     is unavailable — GraphQL fails the whole operation for one unauthorised
     field. audio_url and video_url are the known gated ones and are already
     excluded from TRANSCRIPT_FIELDS. If this fires, something new was added.`);
    }
    return 1;
  }

  // Names are gathered first, longest last so the reverse sort puts the most
  // specific ("Sami Ullah Shah") ahead of the least ("Sami").
  const knownNames = [
    ...new Set((transcript.speakers ?? []).map((sp) => sp.name).filter((n): n is string => !!n))
  ].sort((a, b) => b.length - a.length);

  /**
   * ⚠️ The SUMMARY is replaced wholesale, not scrubbed.
   *
   * Name-substitution is not enough for it. An AI-generated meeting summary is
   * dense real business content — vendors, payment tooling, infrastructure
   * choices, priorities — and none of that belongs in a public repo even with
   * the names removed. A fixture exists to pin the SHAPE of the response, and
   * synthetic prose pins the shape exactly as well.
   *
   * The field names, types and array-vs-string unions are preserved so the Zod
   * schema is still genuinely exercised.
   */
  const syntheticSummary = transcript.summary
    ? {
        ...transcript.summary,
        keywords: ['onboarding', 'tooling', 'scheduling'],
        action_items: 'Speaker One to send the setup guide; Speaker Two to review it.',
        outline: 'Introductions; tooling walkthrough; scheduling; next steps.',
        overview:
          '- **Introductions:** Speaker One and Speaker Two met for an onboarding session.\n' +
          '- **Tooling:** Access and account setup were walked through.\n' +
          '- **Next steps:** Follow-up items were agreed for the coming week.',
        topics_discussed: ['onboarding', 'access setup', 'next steps']
      }
    : transcript.summary;

  const trimmed = {
    ...transcript,
    sentences: (transcript.sentences ?? []).slice(0, keep),
    summary: syntheticSummary
  };

  const s = makeScrubber();
  // Seed the alias map in speaker order, so Speaker One is speakers[0].
  for (const n of [...knownNames].sort()) s.speakerName(n);

  const scrubbed = scrub(trimmed, s, knownNames);
  const counts = s.report();

  // The fixture mirrors a real GraphQL envelope, so tests can feed it straight
  // to the client's response parser.
  const envelope = { data: { transcript: scrubbed } };
  const outPath = join(process.cwd(), 'fixtures', 'fireflies', outName);
  writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`);

  // ── Verify the scrub actually worked, before anyone commits it ────────────
  const written = JSON.stringify(envelope);
  const leaks: string[] = [];
  // ⚠️ Full names AND first names, on word boundaries. An earlier version tested
  // only the full name and would have passed a file still containing "Ardin".
  // The boundaries matter too: a substring match flags "Onboarding" for "ardin".
  for (const n of knownNames) {
    for (const part of [n, ...n.split(/\s+/)]) {
      if (part.length < 3) continue;
      if (new RegExp(`\\b${escapeRe(part)}\\b`, 'i').test(written)) leaks.push(part);
    }
  }
  const realEmails = [...written.matchAll(EMAIL_RE)].map((m) => m[0]);
  for (const e of realEmails) if (!e.endsWith('@example.com')) leaks.push(e);

  // ── The review report ─────────────────────────────────────────────────────
  // Printed in full, not counted, because "2 names scrubbed" is not something a
  // human can check. Seeing the actual mapping is.
  console.log(`\n  wrote     fixtures/fireflies/${outName}`);
  console.log(`  sentences ${(transcript.sentences ?? []).length} → ${keep}`);

  console.log('\n  ── speaker names replaced ──');
  if (counts.speakers.length === 0) console.log('     (none)');
  for (const [real, fake] of counts.speakers) console.log(`     "${real}"  →  "${fake}"`);

  console.log('\n  ── emails replaced ──');
  if (counts.emails.length === 0) console.log('     (none)');
  for (const [real, fake] of counts.emails) {
    // Local part masked: the report is for reviewing WHAT was caught, and the
    // mapping is reconstructable from the transcript if anyone truly needs it.
    const [local, domain] = real.split('@');
    const masked = `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    console.log(`     ${masked}  →  ${fake}`);
  }

  console.log('\n  ── summary prose ──');
  console.log(
    transcript.summary
      ? '     REPLACED WHOLESALE with synthetic text (real summaries are dense\n' +
          '     business content — vendors, tooling, priorities — and this repo is public)'
      : '     (no summary on this transcript)'
  );

  console.log('\n  ── sentence text retained (review these) ──');
  const kept = (scrubbed as { sentences?: { speaker_name?: string; text?: string }[] }).sentences ?? [];
  for (const line of kept) console.log(`     ${line.speaker_name}: ${line.text}`);

  if (leaks.length > 0) {
    console.error(
      `\n  ❌ SCRUB FAILED — these still appear in the file: ${[...new Set(leaks)].join(', ')}`
    );
    console.error('     DO NOT COMMIT. Fix the scrubber first.\n');
    return 1;
  }

  console.log('  ✅ no real names or non-example.com addresses remain\n');
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
