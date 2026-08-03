/**
 * Run the extractor over stored transcripts, from a laptop.
 *
 *   pnpm extract:run --list             # what is extractable, no LLM call
 *   pnpm extract:run --dry <eventId>    # build the prompt, print size, no call
 *   pnpm extract:run <unifiedEventId>   # extract one meeting (COSTS MONEY)
 *   pnpm extract:run --all --limit 3    # extract up to 3 un-extracted meetings
 *
 * Not an eval harness — no scoring, no expected output, no fixtures. This exists
 * so a real extraction can be run and PRICED on demand without going through the
 * queue, which is the only way to know what a meeting actually costs.
 *
 * ⚠️ Every non-dry run spends real OpenRouter credit. The per-run cost is printed
 * and a running total is reported at the end.
 */

import { sql } from 'drizzle-orm';
import { db, pool } from '@/db';
import { aiSpendSoFar } from '@/lib/ai/client';
import { extractActionItems, findExtractableEvents } from '@/features/extraction/extract';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--limit');

async function list() {
  const rows = await db.execute<{
    id: string;
    subject_id: string;
    title: string | null;
    occurred_at: string | Date;
    items: number;
  }>(sql`
    select ue.id, ue.subject_id, t.title, ue.occurred_at,
           (select count(*) from candidate_action_item c where c.unified_event_id = ue.id)::int as items
    from unified_event ue
    join transcript t on t.fireflies_id = ue.subject_id
    where ue.source = 'fireflies' and ue.event_type <> 'test'
    order by ue.occurred_at desc
  `);

  if (rows.rows.length === 0) {
    console.warn('No unified_event rows have a stored transcript. Nothing to extract.');
    return;
  }

  console.warn(`${rows.rows.length} meeting(s) with a stored transcript:\n`);
  for (const r of rows.rows) {
    // db.execute() runs raw SQL and bypasses Drizzle's column mappers, so this
    // arrives as whatever node-postgres decided — a string here, not a Date.
    const when = new Date(r.occurred_at).toISOString().slice(0, 10);
    console.warn(
      `  ${r.id}  ${when}  ${String(r.items).padStart(2)} item(s)  ${r.title ?? '(untitled)'}`
    );
  }
  console.warn('\nRun one with:  pnpm extract:run <id>');
}

async function dry(unifiedEventId: string) {
  // Reaches into the same join the extractor uses, but stops before the call.
  const rows = await db.execute<{ chars: number; lines: number; title: string | null }>(sql`
    select
      coalesce(sum(length(coalesce(s->>'text', '')) + length(coalesce(s->>'speaker_name', '')) + 2), 0)::int as chars,
      count(*)::int as lines,
      max(t.title) as title
    from unified_event ue
    join transcript t on t.fireflies_id = ue.subject_id
    cross join lateral jsonb_array_elements(t.payload->'sentences') as s
    where ue.id = ${unifiedEventId}
  `);

  const r = rows.rows[0];
  if (!r || r.lines === 0) {
    console.warn(`No transcript sentences for ${unifiedEventId}.`);
    return;
  }

  // ~4 chars/token is the usual English approximation; good enough to size a
  // call against a 200k context, which is the only decision it informs.
  const tokens = Math.round(r.chars / 4);
  console.warn(`${r.title ?? '(untitled)'}`);
  console.warn(`  ${r.lines} lines, ${r.chars.toLocaleString()} chars, ≈${tokens.toLocaleString()} tokens`);
  console.warn(`  no LLM call made (--dry)`);
}

async function runOne(unifiedEventId: string) {
  const result = await extractActionItems(unifiedEventId);

  if (result.skippedReason) {
    console.warn(`SKIPPED ${unifiedEventId} — ${result.skippedReason}`);
    return;
  }

  console.warn(
    `\n${unifiedEventId}\n` +
      `  ${result.itemsExtracted} item(s): ${result.itemsWritten} new, ${result.itemsUpdated} updated\n` +
      `  owners: ${Object.entries(result.ownerBreakdown).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}\n` +
      `  tokens: ${result.usage.promptTokens} in / ${result.usage.completionTokens} out\n` +
      `  cost:   $${result.usage.estimatedCostUsd.toFixed(5)}`
  );

  const items = await db.execute<{
    description: string;
    owner_name: string;
    owner_confidence: string;
    due_date: string | null;
    confidence: number;
    source_span: string;
  }>(sql`
    select description, owner_name, owner_confidence, due_date, confidence, source_span
    from candidate_action_item
    where unified_event_id = ${unifiedEventId}
    order by confidence desc
  `);

  for (const i of items.rows) {
    console.warn(
      `\n  • ${i.description}\n` +
        `    owner: ${i.owner_name} (${i.owner_confidence})  due: ${i.due_date ?? '—'}  conf: ${i.confidence}\n` +
        `    "${i.source_span}"`
    );
  }
}

async function main() {
  try {
    if (has('--list')) {
      await list();
      return;
    }

    if (has('--dry')) {
      const id = positional[0];
      if (!id) throw new Error('--dry needs a unified_event id. Try --list first.');
      await dry(id);
      return;
    }

    const ids = has('--all')
      ? await findExtractableEvents(Number(valueOf('--limit') ?? 5))
      : positional;

    if (ids.length === 0) {
      console.warn('Nothing to do. Try --list, or pass a unified_event id.');
      return;
    }

    console.warn(`Extracting ${ids.length} meeting(s). This spends OpenRouter credit.\n`);
    for (const id of ids) await runOne(id);

    const spend = aiSpendSoFar();
    console.warn(
      `\nTotal this run: ${spend.calls} call(s), ` +
        `${spend.promptTokens} in / ${spend.completionTokens} out, $${spend.usd.toFixed(5)}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
