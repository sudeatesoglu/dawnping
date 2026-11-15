import { z } from 'zod';
import {
  isIsoDate,
  isValidTimeZone,
  parseTime,
  parseWorkRange,
  WEEKDAYS,
  type Weekday,
} from '../time.ts';

const WeekdaySchema = z.enum(WEEKDAYS, { error: `must be one of ${WEEKDAYS.join(', ')}` });

/**
 * Planning works in 5-minute slots, so times that feed it use 5-minute
 * steps; anything else would be rounded and plans would be off by minutes.
 */
const onStep = (minutes: number) => minutes % 5 === 0;

const WorkRange = z.string().refine(
  (value) => {
    const range = parseWorkRange(value);
    return range !== undefined && onStep(range.start) && onStep(range.end);
  },
  { error: 'must be a range like 09:00-18:00 in 5-minute steps that ends after it starts' },
);

const IsoDate = z.string().refine(isIsoDate, { error: 'must be a calendar date like 2026-12-31' });

/**
 * Profile names are used as config keys and CLI arguments. Validating them
 * as record keys also stops names like "__proto__" before they are assigned.
 */
const ProfileName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, {
  error: 'name must start with a letter and use only a-z, 0-9 and "-" (max 32)',
});

/** A stretch of the working day with more (or less) activity than usual. */
const BusyRange = z.strictObject({
  range: WorkRange,
  /**
   * Activity relative to an ordinary working stretch (1); 0 is a break.
   * Omitted: learned from the session logs once that exists, else a default.
   */
  weight: z.number().min(0, { error: 'must be 0 (a break) or more' }).max(10).optional(),
});

export const Profile = z
  .strictObject({
    days: z.array(WeekdaySchema).min(1, { error: 'must list at least one day' }),
    work: WorkRange,
    /** "auto" lets dawnping choose; a fixed time like "06:30" overrides it. */
    // One refinement instead of a union, so the error names both options.
    trigger: z.string().refine(
      (value) => {
        const minutes = parseTime(value);
        return value === 'auto' || (minutes !== undefined && onStep(minutes));
      },
      { error: 'must be "auto" or a time in 5-minute steps like 06:30' },
    ),
    busy: z.array(BusyRange).optional(),
  })
  .superRefine((profile, ctx) => {
    // Busy ranges describe parts of the working day; outside it they would
    // silently extend it. May run with invalid fields, so parse defensively.
    const work = parseWorkRange(profile.work);
    if (work === undefined) return;
    const ranges: { index: number; text: string; start: number; end: number; weight?: number }[] =
      [];
    (profile.busy ?? []).forEach((busy, index) => {
      const range = parseWorkRange(busy.range);
      if (range === undefined) return;
      if (range.start < work.start || range.end > work.end) {
        ctx.addIssue({
          code: 'custom',
          path: ['busy', index, 'range'],
          message: `must lie inside the working hours ${profile.work}`,
        });
      }
      ranges.push({
        index,
        text: busy.range,
        ...range,
        ...(busy.weight === undefined ? {} : { weight: busy.weight }),
      });
    });

    // Overlaps would make the weight depend on the order of the list.
    ranges.sort((a, b) => a.start - b.start);
    ranges.forEach((range, i) => {
      const previous = ranges[i - 1];
      if (previous !== undefined && range.start < previous.end) {
        ctx.addIssue({
          code: 'custom',
          path: ['busy', range.index, 'range'],
          message: `overlaps ${previous.text}`,
        });
      }
    });

    // Breaks (weight 0) must leave some working time to plan for.
    const breaks = ranges
      .filter((range) => range.weight === 0)
      .reduce((sum, range) => sum + range.end - range.start, 0);
    if (breaks >= work.end - work.start) {
      ctx.addIssue({ code: 'custom', path: ['busy'], message: 'leaves no working time' });
    }
  });
export type Profile = z.infer<typeof Profile>;

const DEFAULT_PING_MODEL = 'haiku';

export const ConfigSchema = z
  .strictObject({
    /** Lets editors validate the file; ignored by dawnping. */
    $schema: z.string().optional(),
    /** Format version, so future releases can migrate older files. */
    version: z.literal(1, { error: 'must be 1' }),
    /** IANA time zone, e.g. Europe/Istanbul. Omitted: the system time zone. */
    timezone: z
      .string()
      .refine(isValidTimeZone, { error: 'must be an IANA time zone like Europe/Istanbul' })
      .optional(),
    ping: z
      .strictObject({
        // Passed to `claude --model` as its own argument: a value starting
        // with "-" would be read as another flag.
        model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]*$/, {
          error: 'must be a model name or alias like haiku or claude-haiku-5-5',
        }),
      })
      .default({ model: DEFAULT_PING_MODEL }),
    profiles: z.record(ProfileName, Profile),
    /** Dates (YYYY-MM-DD, in the configured time zone) without a ping. */
    skip: z.array(IsoDate).default([]),
  })
  .superRefine((config, ctx) => {
    // Each weekday may belong to at most one profile, so the profile for a
    // day is never ambiguous. This can run even when other fields are
    // invalid, so it must not assume valid data.
    const owner = new Map<Weekday, string>();
    for (const [name, profile] of Object.entries(config.profiles)) {
      for (const day of profile.days) {
        const other = owner.get(day);
        if (other !== undefined && other !== name) {
          ctx.addIssue({
            code: 'custom',
            path: ['profiles', name, 'days'],
            message: `${day} already belongs to profile "${other}"`,
          });
        }
        owner.set(day, name);
      }
    }
  });

/** A validated configuration with defaults applied: what the tool reads. */
export type Config = z.output<typeof ConfigSchema>;

/**
 * The configuration as written in the file, without defaults filled in:
 * what the CLI edits and saves, so a round trip keeps the user's file as
 * it was (no added defaults, same key order).
 */
export type ConfigInput = z.input<typeof ConfigSchema>;

/** A fresh copy of the config used when no file exists yet. */
export function defaultConfigInput(): ConfigInput {
  return {
    version: 1,
    profiles: {
      default: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], work: '09:00-18:00', trigger: 'auto' },
    },
  };
}
