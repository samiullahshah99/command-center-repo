import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClickUpApiError,
  ClickUpSchemaError,
  createTask,
  getLists,
  getTask,
  getTasks,
  normaliseCustomFields,
  updateTaskStatus
} from './client';

const TOKEN = 'pk_test_token_not_real';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'clickup', name), 'utf8'));
}

/** Records every request so shapes can be asserted, and never hits the network. */
function mockFetch(
  responses: { status?: number; body?: unknown; headers?: Record<string, string> }[]
) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...r.headers }
    });
  }) as unknown as typeof fetch;
  return { impl, calls, count: () => i };
}

/** No real sleeping — records the delays instead. */
function mockSleep() {
  const delays: number[] = [];
  return { sleep: async (ms: number) => void delays.push(ms), delays };
}

describe('ClickUp client', () => {
  beforeEach(() => {
    process.env.CLICKUP_API_TOKEN = TOKEN;
  });

  describe('auth', () => {
    it('sends the token RAW, with no Bearer prefix', async () => {
      const f = mockFetch([{ body: fixture('api-task.json') }]);
      await getTask('86eyf1rk7', { fetchImpl: f.impl });

      const auth = (f.calls[0].init.headers as Record<string, string>).Authorization;
      expect(auth).toBe(TOKEN);
      // The single most common ClickUp mistake.
      expect(auth).not.toMatch(/^Bearer/i);
    });

    it('throws rather than sending an empty Authorization header', async () => {
      delete process.env.CLICKUP_API_TOKEN;
      const f = mockFetch([{ body: {} }]);
      await expect(getTask('x', { fetchImpl: f.impl })).rejects.toThrow(/CLICKUP_API_TOKEN/);
      // Never reached the network.
      expect(f.count()).toBe(0);
    });
  });

  describe('Zod validation', () => {
    it('accepts a real captured task response', async () => {
      const f = mockFetch([{ body: fixture('api-task.json') }]);
      const task = await getTask('86eyf1rk7', { fetchImpl: f.impl });
      expect(task.id).toBe('86eyf1rk7');
      expect(typeof task.name).toBe('string');
    });

    it('accepts a real captured list-tasks response', async () => {
      const f = mockFetch([{ body: fixture('api-tasks-list.json') }]);
      const { tasks } = await getTasks('901820032439', {}, { fetchImpl: f.impl });
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('accepts a real captured lists response', async () => {
      const f = mockFetch([{ body: fixture('api-lists.json') }]);
      const lists = await getLists({ spaceId: '901812221191' }, { fetchImpl: f.impl });
      expect(lists.length).toBeGreaterThan(0);
      expect(typeof lists[0].id).toBe('string');
    });

    it('REJECTS a response missing a required field', async () => {
      // A silent shape change must fail loudly at the boundary.
      const f = mockFetch([{ body: { id: '123' } }]); // no `name`
      await expect(getTask('123', { fetchImpl: f.impl })).rejects.toThrow(ClickUpSchemaError);
    });

    it('REJECTS a wrong-typed field', async () => {
      const f = mockFetch([{ body: { id: '123', name: 12345 } }]);
      await expect(getTask('123', { fetchImpl: f.impl })).rejects.toThrow(ClickUpSchemaError);
    });

    it('REJECTS tasks[] not being an array', async () => {
      const f = mockFetch([{ body: { tasks: 'nope' } }]);
      await expect(getTasks('1', {}, { fetchImpl: f.impl })).rejects.toThrow(ClickUpSchemaError);
    });

    it('the schema error names the endpoint and the failing field', async () => {
      const f = mockFetch([{ body: { id: '123' } }]);
      await expect(getTask('123', { fetchImpl: f.impl })).rejects.toThrow(/\/task\/123/);
      await expect(getTask('123', { fetchImpl: f.impl })).rejects.toThrow(/name/);
    });

    it('TOLERATES unknown extra fields (ClickUp adds them)', async () => {
      const body = { ...(fixture('api-task.json') as object), brand_new_field: 'whatever' };
      const f = mockFetch([{ body }]);
      await expect(getTask('86eyf1rk7', { fetchImpl: f.impl })).resolves.toBeTruthy();
    });

    it('coerces numeric list ids to strings', async () => {
      // ClickUp returns ids as numbers on some endpoints, strings on others.
      const f = mockFetch([{ body: { lists: [{ id: 12345, name: 'Numeric' }] } }]);
      const lists = await getLists({ spaceId: '1' }, { fetchImpl: f.impl });
      expect(lists[0].id).toBe('12345');
    });
  });

  describe('429 backoff', () => {
    it('retries after a 429 and succeeds', async () => {
      const s = mockSleep();
      const f = mockFetch([{ status: 429 }, { status: 429 }, { body: fixture('api-task.json') }]);

      const task = await getTask('86eyf1rk7', { fetchImpl: f.impl, sleep: s.sleep });

      expect(task.id).toBe('86eyf1rk7');
      expect(f.count()).toBe(3);
      expect(s.delays).toHaveLength(2);
    });

    it('backs off exponentially when no headers are given', async () => {
      const s = mockSleep();
      const f = mockFetch([{ status: 429 }, { status: 429 }, { body: fixture('api-task.json') }]);
      await getTask('x', { fetchImpl: f.impl, sleep: s.sleep });
      expect(s.delays[0]).toBe(1000);
      expect(s.delays[1]).toBe(2000);
    });

    it('honours Retry-After over its own backoff', async () => {
      const s = mockSleep();
      const f = mockFetch([
        { status: 429, headers: { 'retry-after': '7' } },
        { body: fixture('api-task.json') }
      ]);
      await getTask('x', { fetchImpl: f.impl, sleep: s.sleep });
      expect(s.delays[0]).toBe(7000);
    });

    it('gives up after the retry budget and reports the rate limit', async () => {
      const s = mockSleep();
      const f = mockFetch([{ status: 429 }]);
      await expect(getTask('x', { fetchImpl: f.impl, sleep: s.sleep })).rejects.toThrow(
        ClickUpApiError
      );
      await expect(getTask('x', { fetchImpl: f.impl, sleep: s.sleep })).rejects.toThrow(/100/);
    });

    it('does NOT retry a 4xx that is not 429', async () => {
      const s = mockSleep();
      const f = mockFetch([
        { status: 401, body: { err: 'Team not authorized', ECODE: 'OAUTH_027' } }
      ]);
      await expect(getTask('x', { fetchImpl: f.impl, sleep: s.sleep })).rejects.toThrow(
        /Team not authorized/
      );
      expect(f.count()).toBe(1);
      expect(s.delays).toHaveLength(0);
    });
  });

  describe('custom field normalisation', () => {
    it('turns the array into a map keyed by name', () => {
      const map = normaliseCustomFields([
        { id: 'f1', name: 'Brief Type', type: 'drop_down', value: 2 },
        { id: 'f2', name: 'Word Count', type: 'number', value: 1200 }
      ]);
      expect(Object.keys(map)).toEqual(['Brief Type', 'Word Count']);
    });

    it('preserves the whole field object, not just the value', () => {
      // id matters: writes address custom fields by id, not name.
      const map = normaliseCustomFields([
        { id: 'f1', name: 'Brief Type', type: 'drop_down', value: 2 }
      ]);
      expect(map['Brief Type']).toEqual({
        id: 'f1',
        name: 'Brief Type',
        type: 'drop_down',
        value: 2
      });
    });

    it('does not coerce polymorphic values', () => {
      // value is a string / number / array / object depending on type. Guessing
      // would silently corrupt data.
      const map = normaliseCustomFields([
        { id: 'a', name: 'Labels', type: 'labels', value: [{ id: 'o1', label: 'urgent' }] },
        { id: 'b', name: 'Notes', type: 'text', value: 'hello' }
      ]);
      expect(map.Labels.value).toEqual([{ id: 'o1', label: 'urgent' }]);
      expect(map.Notes.value).toBe('hello');
    });

    it('handles a missing value', () => {
      const map = normaliseCustomFields([{ id: 'a', name: 'Empty', type: 'text' }]);
      expect(map.Empty.value).toBeUndefined();
    });

    it('warns and keeps the last on duplicate names', () => {
      // ClickUp does not guarantee unique custom-field names.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const map = normaliseCustomFields([
        { id: 'a', name: 'Dup', type: 'text', value: 'first' },
        { id: 'b', name: 'Dup', type: 'text', value: 'second' }
      ]);
      expect(map.Dup.id).toBe('b');
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it('returns an empty map for no fields', () => {
      expect(normaliseCustomFields([])).toEqual({});
    });
  });

  describe('request shapes', () => {
    it('createTask POSTs to the list endpoint with the payload as JSON', async () => {
      const f = mockFetch([{ body: fixture('api-task.json') }]);
      await createTask(
        '901820032439',
        { name: 'New task', description: 'body', status: 'to do' },
        { fetchImpl: f.impl }
      );

      const { url, init } = f.calls[0];
      expect(url).toBe('https://api.clickup.com/api/v2/list/901820032439/task');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        name: 'New task',
        description: 'body',
        status: 'to do'
      });
    });

    it('updateTaskStatus PUTs only the status field', async () => {
      const f = mockFetch([{ body: fixture('api-task.json') }]);
      await updateTaskStatus('86eyf1rk7', 'in progress', { fetchImpl: f.impl });

      const { url, init } = f.calls[0];
      expect(url).toBe('https://api.clickup.com/api/v2/task/86eyf1rk7');
      expect(init.method).toBe('PUT');
      // Nothing else is sent — a wider PUT could clobber fields we did not read.
      expect(JSON.parse(init.body as string)).toEqual({ status: 'in progress' });
    });

    it('getTasks serialises array filters as repeated keys', async () => {
      const f = mockFetch([{ body: { tasks: [] } }]);
      await getTasks(
        '1',
        { page: 2, assignees: ['111', '222'], statuses: ['to do', 'done'] },
        { fetchImpl: f.impl }
      );

      const url = f.calls[0].url;
      expect(url).toContain('page=2');
      // ClickUp expects repeated keys, not CSV.
      expect(url).toContain('assignees%5B%5D=111');
      expect(url).toContain('assignees%5B%5D=222');
      expect(url).not.toContain('assignees=111%2C222');
    });

    it('getTasks omits the query string entirely with no filters', async () => {
      const f = mockFetch([{ body: { tasks: [] } }]);
      await getTasks('1', {}, { fetchImpl: f.impl });
      expect(f.calls[0].url).toBe('https://api.clickup.com/api/v2/list/1/task');
    });

    it('getLists picks the folder endpoint when given a folderId', async () => {
      const f = mockFetch([{ body: { lists: [] } }]);
      await getLists({ folderId: '999' }, { fetchImpl: f.impl });
      expect(f.calls[0].url).toBe('https://api.clickup.com/api/v2/folder/999/list');
    });

    it('getLists picks the space endpoint when given a spaceId', async () => {
      const f = mockFetch([{ body: { lists: [] } }]);
      await getLists({ spaceId: '888' }, { fetchImpl: f.impl });
      expect(f.calls[0].url).toBe('https://api.clickup.com/api/v2/space/888/list');
    });

    it('never writes to the real ClickUp API in tests', () => {
      // All tests inject fetchImpl. If one forgot, it would hit the network with
      // a fake token and fail — this documents the contract.
      expect(process.env.CLICKUP_API_TOKEN).toBe(TOKEN);
      expect(TOKEN).toMatch(/not_real/);
    });
  });
});
