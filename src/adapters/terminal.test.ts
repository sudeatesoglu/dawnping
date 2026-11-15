import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { confirm, openInEditor } from './terminal.ts';

describe('openInEditor', () => {
  it("resolves with the editor's exit code", async () => {
    expect(await openInEditor('/dev/null', { EDITOR: 'true' })).toBe(0);
    expect(await openInEditor('/dev/null', { EDITOR: 'false' })).toBe(1);
  });

  it('prefers VISUAL over EDITOR', async () => {
    expect(await openInEditor('/dev/null', { VISUAL: 'true', EDITOR: 'false' })).toBe(0);
  });

  it('passes the file name as an argument, never as shell code', async () => {
    // If the name were pasted into the command, `exit 7` would run.
    const code = await openInEditor('x"; exit 7; "', { EDITOR: 'test -n' });
    expect(code).toBe(0);
  });
});

describe('confirm', () => {
  const ask = async (answer: string) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = confirm('Continue?', input, output);
    input.end(`${answer}\n`);
    return pending;
  };

  it.each([
    ['', true],
    ['y', true],
    ['YES', true],
    ['n', false],
    ['nope', false],
  ])('treats %j as %s', async (answer, expected) => {
    expect(await ask(answer)).toBe(expected);
  });

  it('treats closed input (Ctrl-D) as no', async () => {
    const input = new PassThrough();
    const pending = confirm('Continue?', input, new PassThrough());
    input.end();
    expect(await pending).toBe(false);
  });
});
