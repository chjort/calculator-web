/** Postgres unique_violation on the given constraint/index name. */
export function isUniqueViolation(e: unknown, constraint: string): boolean {
  const err = (e as { cause?: unknown })?.cause ?? e;
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
    && (err as { constraint?: string }).constraint === constraint;
}
