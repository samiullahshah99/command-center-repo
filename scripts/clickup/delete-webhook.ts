/**
 * Delete a ClickUp webhook — `pnpm clickup:delete <webhook_id>`
 *
 * MANUAL ONLY. Needed because re-registering during testing leaves duplicates,
 * and ClickUp does not deduplicate them.
 *
 * Deleting a webhook permanently discards its signing secret. If it was the one
 * in CLICKUP_WEBHOOK_SECRET, that value becomes dead and a new registration
 * produces a new secret that must be set in both .env.local and Railway.
 */

import { banner, clickUpFetch, loadEnvLocal, requireEnv, type ClickUpWebhook } from './shared';

loadEnvLocal();

async function main() {
  banner('Delete ClickUp webhook');

  const token = requireEnv('CLICKUP_API_TOKEN');
  const teamId = requireEnv('CLICKUP_TEAM_ID');

  const id = process.argv[2];
  if (!id || id.startsWith('--')) {
    console.error('  ❌ Usage: pnpm clickup:delete <webhook_id>');
    console.error('     List IDs with: pnpm clickup:list');
    process.exit(1);
  }

  // Confirm it exists first, so a typo reports "not found" rather than a bare
  // API error — and so the endpoint being removed is visible before it goes.
  const existing = await clickUpFetch<{ webhooks: ClickUpWebhook[] }>(
    `/team/${teamId}/webhook`,
    token
  );
  const target = (existing.webhooks ?? []).find((w) => w.id === id);

  if (!target) {
    console.error(`  ❌ No webhook with id ${id} in team ${teamId}.`);
    console.error('     List current webhooks with: pnpm clickup:list');
    process.exit(1);
  }

  console.log(`  deleting : ${id}`);
  console.log(`  endpoint : ${target.endpoint ?? '(none)'}\n`);

  await clickUpFetch(`/webhook/${id}`, token, { method: 'DELETE' });

  console.log('  ✅ Deleted\n');
  console.log('  Its signing secret is now dead. If CLICKUP_WEBHOOK_SECRET held');
  console.log('  it, re-register and replace the value in .env.local and Railway.');
}

main().catch((err) => {
  console.error(`\n  ❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
