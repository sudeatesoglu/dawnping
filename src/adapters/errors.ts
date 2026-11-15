/** The error code of a Node.js system error ("ENOENT", "EEXIST"...), if any. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
