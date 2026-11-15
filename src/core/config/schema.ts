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

const WorkRange = z.string().refine((value) => parseWorkRange(value) !== undefined, {
  error: 'must be a range like 09:00-18:00 that ends after it starts',
});

const IsoDate = z.string().refine(isIsoDate, { error: 'must be a calendar date like 2026-12-31' });

/** Profile names are used as config keys and CLI arguments. */
const PROFILE_NAME = /^[a-z][a-z0-9-]{0,31}$/;

export const Profile = z.strictObject({
  days: z.array(WeekdaySchema).min(1, { error: 'must list at least one day' }),
  work: WorkRange,
  /** "auto" lets dawnping choose; a fixed time like "06:30" overrides it. */
  // One refinement instead of a union, so the error names both options.
  trigger: z.string().refine((value) => value === 'auto' || parseTime(value) !== undefined, {
    error: 'must be "auto" or a time like 06:30',
  }),
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
      .strictObject({ model: z.string().min(1, { error: 'must not be empty' }) })
      .default({ model: DEFAULT_PING_MODEL }),
    // Names are checked below: a key schema here would only report "Invalid key in record".
    profiles: z.record(z.string(), Profile),
    /** Dates (YYYY-MM-DD, in the configured time zone) without a ping. */
    skip: z.array(IsoDate).default([]),
  })
  .superRefine((config, ctx) => {
    // Cross-field checks. They run once every field is valid, so a file
    // with field errors reports those first.
    // Profile names are CLI arguments. Each weekday may belong to at most
    // one profile, so the profile for a day is never ambiguous.
    const owner = new Map<Weekday, string>();
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (!PROFILE_NAME.test(name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['profiles', name],
          message: 'name must start with a letter and use only a-z, 0-9 and "-" (max 32)',
        });
      }
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

/** A validated configuration with defaults applied. */
export type Config = z.output<typeof ConfigSchema>;

/** Used when no config file exists yet. */
export const DEFAULT_CONFIG: Config = {
  version: 1,
  ping: { model: DEFAULT_PING_MODEL },
  profiles: {
    default: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], work: '09:00-18:00', trigger: 'auto' },
  },
  skip: [],
};
