/**
 * ClickUp API verification — `pnpm verify:clickup`
 *
 * READ-ONLY. Confirms auth works, then walks the workspace so the LIST IDS
 * needed for webhook registration and task queries are visible.
 *
 * Writes nothing. Prints no token.
 */

import { banner, loadEnvLocal, requireEnv } from './shared';

loadEnvLocal();

const MAX_LISTS_TO_SAMPLE = 3;
const MAX_TASKS_TO_SHOW = 3;

async function main() {
  banner('ClickUp API verification');

  requireEnv('CLICKUP_API_TOKEN');
  const teamId = requireEnv('CLICKUP_TEAM_ID');

  // Imported inside main(), after env is loaded and because tsx compiles these
  // scripts to CJS, where top-level await is unavailable.
  const { getLists, getSpaces, getTasks, getTeams, normaliseCustomFields } = await import(
    '@/features/connectors/clickup/client'
  );

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const teams = await getTeams();
  console.log(`  ✅ Auth OK — ${teams.length} team(s) visible:\n`);
  for (const t of teams) {
    const marker = t.id === teamId ? '  <- CLICKUP_TEAM_ID' : '';
    console.log(`     ${t.id}  ${t.name}${marker}`);
  }

  if (!teams.some((t) => t.id === teamId)) {
    console.error(`\n  ⚠️  CLICKUP_TEAM_ID (${teamId}) is not in the list above.`);
    console.error('     Queries scoped to it will return nothing.');
  }

  // ── 2. Spaces ─────────────────────────────────────────────────────────────
  console.log('\n  ── Spaces ──\n');
  const spaces = await getSpaces(teamId);
  if (spaces.length === 0) {
    console.log('     (none — the token may lack access, or the workspace is empty)');
    return;
  }
  for (const s of spaces) {
    console.log(`     ${s.id}  ${s.name}${s.private ? '  (private)' : ''}`);
  }

  // ── 3. Lists ──────────────────────────────────────────────────────────────
  // Folderless lists only. Lists inside folders need /folder/{id}/list, which
  // means enumerating folders first — deliberately not done here, since this is
  // a connectivity check rather than a crawler.
  console.log('\n  ── Lists (folderless, per space) ──\n');

  const allLists: { id: string; name: string; space: string }[] = [];
  for (const s of spaces) {
    try {
      const lists = await getLists({ spaceId: s.id });
      if (lists.length === 0) {
        console.log(`     ${s.name}: (no folderless lists)`);
        continue;
      }
      for (const l of lists) {
        console.log(`     ${l.id}  ${l.name}   [space: ${s.name}]`);
        allLists.push({ id: l.id, name: l.name, space: s.name });
      }
    } catch (err) {
      console.log(`     ${s.name}: ⚠️ ${err instanceof Error ? err.message : err}`);
    }
  }

  if (allLists.length === 0) {
    console.log('\n  No folderless lists found. Lists inside folders are not walked here.');
    return;
  }

  // ── 4. Sample tasks ───────────────────────────────────────────────────────
  console.log('\n  ── Sample tasks ──\n');
  for (const l of allLists.slice(0, MAX_LISTS_TO_SAMPLE)) {
    try {
      const { tasks } = await getTasks(l.id, { page: 0 });
      console.log(`     ${l.name} (${l.id}): ${tasks.length} task(s) on page 0`);

      for (const t of tasks.slice(0, MAX_TASKS_TO_SHOW)) {
        const custom = normaliseCustomFields(t.custom_fields);
        const customNames = Object.keys(custom);
        console.log(`        ${t.id}  ${t.name}`);
        console.log(
          `           status=${t.status?.status ?? 'n/a'}  assignees=${t.assignees.length}` +
            `  customFields=${customNames.length}${
              customNames.length ? ` [${customNames.slice(0, 4).join(', ')}]` : ''
            }`
        );
      }
    } catch (err) {
      console.log(`     ${l.name}: ⚠️ ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 5. Summary for webhook registration ───────────────────────────────────
  console.log('\n  ' + '─'.repeat(64));
  console.log('  LIST IDS');
  console.log('  ' + '─'.repeat(64));
  for (const l of allLists) console.log(`    ${l.id}  ${l.name}  [${l.space}]`);
  console.log(
    '\n  The webhook is registered TEAM-WIDE (pnpm clickup:register), so these\n' +
      '  are not needed for registration — they are for scoping task queries.'
  );
}

main().catch((err) => {
  console.error(`\n  ❌ ${err instanceof Error ? err.message : err}`);
  console.error('\n  Common causes:');
  console.error('    OAUTH_025          "Bearer " prefix on the token (must be raw)');
  console.error('    OAUTH_017          Authorization header missing');
  console.error('    ClickUpSchemaError the API shape changed — see the issues listed above');
  process.exit(1);
});
