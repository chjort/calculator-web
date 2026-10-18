import { ErrorResponse, MeResponse, ProfileDto, SessionInfo, type ErrorCode, type SettingsPatch } from "@calc/contracts";
import type { DecimalString } from "@calc/engine";
import type { z } from "zod";

/** A failed API call: an HTTP error with a contract error code, or no connection at all. */
export class ApiFailure extends Error {
  constructor(
    readonly kind: "http" | "network",
    readonly status: number,
    readonly code: ErrorCode | null,
    readonly fields: Record<string, string> = {},
  ) {
    super(code ?? kind);
  }
}

type Unauthorized = (code: "unauthenticated" | "session_expired") => void;
let onUnauthorized: Unauthorized = () => {};
/** The app decides what a 401 means (go to log in). */
export function setUnauthorizedHandler(h: Unauthorized) { onUnauthorized = h; }

let onActivity: (info: SessionInfo) => void = () => {};
export function setActivityHandler(h: (info: SessionInfo) => void) { onActivity = h; }

async function request<S extends z.ZodType>(method: string, path: string, schema: S | null, body?: unknown, opts: { quiet401?: boolean } = {}): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure("network", 0, null);
  }
  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(await res.json().catch(() => null));
    const err = parsed.success ? parsed.data.error : null;
    const failure = new ApiFailure("http", res.status, err?.code ?? null, err?.fields ?? {});
    if (res.status === 401 && !opts.quiet401) {
      // A switch in flight may have rotated the cookie: re-read /me once before giving up (R2.md §4).
      if (path !== "/api/me" && (await api.me().then(() => true, () => false))) throw failure;
      onUnauthorized(err?.code === "session_expired" ? "session_expired" : "unauthenticated");
    }
    throw failure;
  }
  return (schema ? schema.parse(res.status === 204 ? undefined : await res.json()) : undefined) as z.infer<S>;
}

export const api = {
  me: () => request("GET", "/api/me", MeResponse, undefined, { quiet401: true }),
  signup: (email: string, password: string) => request("POST", "/api/auth/signup", MeResponse, { email, password }, { quiet401: true }),
  login: (email: string, password: string) => request("POST", "/api/auth/login", MeResponse, { email, password }, { quiet401: true }),
  logout: () => request("POST", "/api/auth/logout", null, undefined, { quiet401: true }),
  touch: async () => { const info = await request("POST", "/api/session/touch", SessionInfo); onActivity(info); return info; },
  setAns: async (ans: DecimalString | null) => { const info = await request("PATCH", "/api/profile/ans", SessionInfo, { ans }); onActivity(info); return info; },
  updateSettings: (patch: SettingsPatch) => request("PATCH", "/api/profile/settings", ProfileDto, patch),
  createProfile: (name: string) => request("POST", "/api/profiles", MeResponse, { name }),
  renameProfile: (id: string, name: string) => request("PATCH", `/api/profiles/${id}`, ProfileDto, { name }),
  deleteProfile: (id: string) => request("DELETE", `/api/profiles/${id}`, MeResponse),
  activateProfile: (id: string) => request("POST", `/api/profiles/${id}/activate`, MeResponse),
};
