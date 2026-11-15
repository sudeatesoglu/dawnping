import { describe, expect, it } from 'vitest';
import { createUnsupportedScheduler } from './unsupported.ts';

describe('createUnsupportedScheduler', () => {
  it('explains that only macOS is supported', async () => {
    const scheduler = createUnsupportedScheduler('linux');
    await expect(scheduler.install({} as never)).rejects.toThrow(
      'background mode is only available on macOS for now (this is linux)',
    );
    await expect(scheduler.uninstall()).rejects.toThrow('only available on macOS');
    expect(await scheduler.isInstalled()).toBe(false);
  });
});
