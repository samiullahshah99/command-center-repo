/**
 * List ClickUp webhooks — `pnpm clickup:list`
 *
 * Read-only. Shows IDs and health so a suspended webhook is visible.
 */

import {
  banner,
  clickUpFetch,
  loadEnvLocal,
  requireEnv,
  type ClickUpWebhook
} from './shared';

loadEnvLocal();

async function main() {
  banner('ClickUp webhooks');

  const token = requireEnv('CLICKUP_API_TOKEN');
  const teamId = requireEnv('CLICKUP_TEAM_ID');

  const body = await clickUpFetch<{ webhooks: ClickUpWebhook[] }>(
    `/team/${teamId}/webhook`,
    token
  );

  const hooks = body.webhooks ?? [];

  if (hooks.length === 0) {
    console.log('  No webhooks registered.\n');
    console.log('  Register one with: pnpm clickup:register');
    return;
  }

  console.log(`  ${hooks.length} webhook${hooks.length === 1 ? '' : 's'}:\n`);

  for (const h of hooks) {
    const status = h.health?.status ?? 'unknown';
    const fails = h.health?.fail_count ?? 0;
    // ClickUp suspends a webhook after repeated failures, so surface this rather
    // than burying it — a suspended hook delivers nothing and looks like silence.
    const flag = status === 'active' ? '✅' : '⚠️ ';

    console.log(`  ${flag} ${h.id}`);
    console.log(`     endpoint : ${h.endpoint ?? '(none)'}`);
    console.log(`     health   : ${status}${fails > 0 ? `  (fail_count=${fails})` : ''}`);
    console.log(`     events   : ${(h.events ?? []).join(', ') || '(none)'}`);

    const scope =
      h.list_id != null
        ? `list ${h.list_id}`
        : h.folder_id != null
          ? `folder ${h.folder_id}`
          : h.space_id != null
            ? `space ${h.space_id}`
            : h.task_id != null
              ? `task ${h.task_id}`
              : 'team-wide';
    console.log(`     scope    : ${scope}`);
    // The secret is returned ONLY at creation, never here.
    console.log(`     secret   : not retrievable after creation\n`);
  }

  if (hooks.length > 1) {
    console.log('  ⚠️  More than one webhook is registered. ClickUp does NOT');
    console.log('     deduplicate registrations, so overlapping webhooks each');
    console.log('     deliver — you will receive every event multiple times.');
    console.log('     Remove extras with: pnpm clickup:delete <id>');
  }
}

main().catch((err) => {
  console.error(`\n  ❌ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
