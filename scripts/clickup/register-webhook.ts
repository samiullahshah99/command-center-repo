/**
 * Register the ClickUp webhook — `pnpm clickup:register`
 *
 * MANUAL ONLY. Never call this on boot.
 *
 * ClickUp does NOT deduplicate registrations: running this twice creates two
 * webhooks that BOTH deliver every event. This script therefore refuses to
 * proceed if a webhook already points at the same endpoint, unless --force is
 * passed.
 *
 * Scope is TEAM-WIDE. ClickUp allows only one location per webhook, so scoping to
 * N lists would mean N webhooks and N signing secrets to manage.
 *
 * The response contains the signing secret. It is shown ONCE here and is not
 * retrievable afterwards — listing webhooks does not return it.
 */

import {
  banner,
  clickUpFetch,
  loadEnvLocal,
  requireEnv,
  type ClickUpWebhook
} from './shared';

loadEnvLocal();

const EVENTS = ['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskDeleted'] as const;

const DEFAULT_ENDPOINT =
  'https://command-center-repo-production.up.railway.app/api/webhooks/clickup';

async function main() {
  banner('Register ClickUp webhook');

  const token = requireEnv('CLICKUP_API_TOKEN');
  const teamId = requireEnv('CLICKUP_TEAM_ID');

  const force = process.argv.includes('--force');
  // Allow an override for testing against a tunnel, e.g. ngrok.
  const endpointArg = process.argv.find((a) => a.startsWith('--endpoint='));
  const endpoint = endpointArg ? endpointArg.split('=').slice(1).join('=') : DEFAULT_ENDPOINT;

  if (!endpoint.startsWith('https://')) {
    console.error('  ❌ Endpoint must be https — ClickUp rejects plain http.');
    process.exit(1);
  }

  console.log(`  team     : ${teamId}`);
  console.log(`  endpoint : ${endpoint}`);
  console.log(`  events   : ${EVENTS.join(', ')}`);
  console.log(`  scope    : team-wide\n`);

  // ── Guard against duplicate registration ────────────────────────────────
  const existing = await clickUpFetch<{ webhooks: ClickUpWebhook[] }>(
    `/team/${teamId}/webhook`,
    token
  );
  const clash = (existing.webhooks ?? []).filter((w) => w.endpoint === endpoint);

  if (clash.length > 0 && !force) {
    console.error(`  ❌ ${clash.length} webhook(s) already point at this endpoint:`);
    for (const w of clash) console.error(`       ${w.id}`);
    console.error('\n     ClickUp does NOT deduplicate — registering again means every');
    console.error('     event is delivered twice. Either delete the existing one:');
    console.error(`       pnpm clickup:delete ${clash[0].id}`);
    console.error('     or pass --force if you genuinely want a second webhook.');
    process.exit(1);
  }

  // ── Create ──────────────────────────────────────────────────────────────
  // ClickUp calls the endpoint to check reachability, so the handler must
  // already be DEPLOYED. Against an undeployed URL this fails.
  const created = await clickUpFetch<{ id: string; webhook: ClickUpWebhook }>(
    `/team/${teamId}/webhook`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        endpoint,
        events: [...EVENTS]
        // No space_id / folder_id / list_id / task_id -> team-wide.
      })
    }
  );

  const hook = created.webhook ?? ({} as ClickUpWebhook);
  const secret = hook.secret;

  console.log('  ✅ Webhook created\n');
  console.log(`     id     : ${created.id ?? hook.id}`);
  console.log(`     health : ${hook.health?.status ?? 'unknown'}\n`);

  if (!secret) {
    console.error('  ⚠️  No secret in the response. Without it the handler cannot');
    console.error('     verify signatures and will 401 every delivery. Delete this');
    console.error('     webhook and check the ClickUp API response shape.');
    process.exit(1);
  }

  // The one place this value is ever printed. It is not retrievable later.
  console.log('  ' + '─'.repeat(64));
  console.log('  SIGNING SECRET — shown once, not retrievable after this');
  console.log('  ' + '─'.repeat(64));
  console.log(`\n  CLICKUP_WEBHOOK_SECRET=${secret}\n`);
  console.log('  ' + '─'.repeat(64));
  console.log('\n  Add it in BOTH places:');
  console.log('    1. .env.local          (no spaces around "=")');
  console.log('    2. Railway -> service -> Variables');
  console.log('\n  Until it is set, every delivery returns 401 and ClickUp will');
  console.log('  eventually suspend the webhook for repeated failures.');
}

main().catch((err) => {
  console.error(`\n  ❌ ${err instanceof Error ? err.message : err}`);
  console.error('\n  Common causes:');
  console.error('    OAUTH_025      "Bearer " prefix on the token (must be raw)');
  console.error('    OAUTH_017      Authorization header missing entirely');
  console.error('    unreachable    handler not deployed yet — deploy first');
  process.exit(1);
});
