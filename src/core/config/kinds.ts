import { z } from 'zod';
import { ConfigSchema } from './schema.ts';

/** What kind of value a setting holds, as far as the command line cares. */
export type SettingKind = 'list' | 'number' | 'boolean' | 'text';

/**
 * Looks up the kind of the setting at a key path in the schema itself, so
 * `config set profiles.weekend.days sat,sun` makes a list even before the
 * profile exists. Returns undefined for paths the schema does not know.
 */
export function settingKind(path: readonly string[]): SettingKind | undefined {
  let schema: z.ZodType = ConfigSchema;
  for (const key of path) {
    schema = unwrap(schema);
    if (schema instanceof z.ZodObject) {
      const child = (schema.shape as Record<string, z.ZodType>)[key];
      if (child === undefined || !Object.hasOwn(schema.shape, key)) return undefined;
      schema = child;
    } else if (schema instanceof z.ZodRecord) {
      schema = schema.valueType as z.ZodType;
    } else {
      return undefined;
    }
  }
  schema = unwrap(schema);
  if (schema instanceof z.ZodArray) return 'list';
  if (schema instanceof z.ZodNumber) return 'number';
  if (schema instanceof z.ZodBoolean) return 'boolean';
  if (schema instanceof z.ZodLiteral && [...schema.values].every((v) => typeof v === 'number')) {
    return 'number';
  }
  return 'text';
}

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}
