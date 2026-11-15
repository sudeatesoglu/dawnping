import { describe, expect, it } from 'vitest';
import {
  findPingEntry,
  LOG_TOLERANCE_MS,
  type LogEntry,
  projectFolderName,
} from './session-logs.ts';

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

  it('allows for timestamp rounding', () => {
    const rounded = entry('-ping', -LOG_TOLERANCE_MS);
    expect(findPingEntry([rounded], '-ping', startedAt)).toBe(rounded);
  });

  it('does not take an earlier ping as confirmation', () => {
    // A ping 40 seconds earlier, e.g. the scheduled one before a manual one.
    expect(findPingEntry([entry('-ping', -40_000)], '-ping', startedAt)).toBeUndefined();
  });

  it('ignores other folders', () => {
    expect(findPingEntry([entry('-work', 2_000)], '-ping', startedAt)).toBeUndefined();
  });
});
