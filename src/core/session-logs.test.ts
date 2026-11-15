import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_MS, findPingEntry, type LogEntry, projectFolderName } from './session-logs.ts';

describe('projectFolderName', () => {
  it.each([
    // Observed in the spike and the manual ping test (ADR-0003).
    ['/Users/u/.local/state/dawnping/ping', '-Users-u--local-state-dawnping-ping'],
    ['/private/var/folders/wk/abc_def/T/tmp.N5pyJ', '-private-var-folders-wk-abc-def-T-tmp-N5pyJ'],
  ])('%s → %s', (path, folder) => {
    expect(projectFolderName(path)).toBe(folder);
  });
});

describe('findPingEntry', () => {
  const startedAt = Date.parse('2026-11-15T16:32:13Z');
  const entry = (folder: string, offsetMs: number): LogEntry => ({
    timestamp: startedAt + offsetMs,
    model: 'claude-haiku-5-5',
    folder,
  });

  it('finds an answer in the ping folder after the ping started', () => {
    const ping = entry('-ping', 2_000);
    expect(findPingEntry([entry('-work', 1_000), ping], '-ping', startedAt)).toBe(ping);
  });

  it('allows for a slightly different clock', () => {
    const early = entry('-ping', -CLOCK_SKEW_MS + 1);
    expect(findPingEntry([early], '-ping', startedAt)).toBe(early);
  });

  it('ignores older pings and other folders', () => {
    expect(
      findPingEntry(
        [entry('-ping', -CLOCK_SKEW_MS - 1), entry('-work', 2_000)],
        '-ping',
        startedAt,
      ),
    ).toBeUndefined();
  });
});
