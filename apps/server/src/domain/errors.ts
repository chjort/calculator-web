import type { ErrorCode } from "@calc/contracts";

/** A failure the API reports to the client as `ErrorResponse` (R2.md §4). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "Not found.");
