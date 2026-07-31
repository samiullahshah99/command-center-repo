import { afterEach, describe, expect, it, vi } from 'vitest';
import { isClickUpSourceOfRecord, isInternalSourceOfRecord, taskSourceOfRecord } from './env';

const original = process.env.TASK_SOURCE_OF_RECORD;

afterEach(() => {
  if (original === undefined) delete process.env.TASK_SOURCE_OF_RECORD;
  else process.env.TASK_SOURCE_OF_RECORD = original;
});

describe('taskSourceOfRecord', () => {
  it('defaults to clickup when unset', () => {
    delete process.env.TASK_SOURCE_OF_RECORD;
    expect(taskSourceOfRecord()).toBe('clickup');
  });

  it('defaults to clickup when empty', () => {
    process.env.TASK_SOURCE_OF_RECORD = '   ';
    expect(taskSourceOfRecord()).toBe('clickup');
  });

  it('reads internal', () => {
    process.env.TASK_SOURCE_OF_RECORD = 'internal';
    expect(taskSourceOfRecord()).toBe('internal');
    expect(isInternalSourceOfRecord()).toBe(true);
    expect(isClickUpSourceOfRecord()).toBe(false);
  });

  it('warns and falls back on an unrecognised value rather than throwing', () => {
    // A typo in Railway must not take the app down.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.TASK_SOURCE_OF_RECORD = 'jira';
    expect(taskSourceOfRecord()).toBe('clickup');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('is read at CALL time, not module load', () => {
    // A module-level const would be baked in during next build, where the
    // variable may not exist — the mistake that broke the Docker build once.
    process.env.TASK_SOURCE_OF_RECORD = 'internal';
    expect(taskSourceOfRecord()).toBe('internal');
    process.env.TASK_SOURCE_OF_RECORD = 'clickup';
    expect(taskSourceOfRecord()).toBe('clickup');
  });
});
