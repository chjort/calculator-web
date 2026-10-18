import { createHash, randomBytes } from "node:crypto";
import type { SessionToken } from "../domain/types";

export const newToken = () => randomBytes(32).toString("base64url") as SessionToken;
export const hashToken = (t: string) => createHash("sha256").update(t).digest();
