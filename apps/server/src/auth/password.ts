import { hash, verify } from "@node-rs/argon2";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ADR 0005: argon2id (the @node-rs/argon2 default algorithm), m=19 MiB, t=2, p=1, NFKC-normalised input.
const PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const PARAMS_TAG = `m=${PARAMS.memoryCost},t=${PARAMS.timeCost},p=${PARAMS.parallelism}`;

export const normalizePassword = (pw: string) => pw.normalize("NFKC");

export function hashPassword(pw: string): Promise<string> {
  return hash(normalizePassword(pw), PARAMS);
}

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, normalizePassword(pw));
  } catch {
    return false;
  }
}

/** True when the stored hash was made with other parameters (re-hash on successful login). */
export const needsRehash = (stored: string) => !stored.startsWith(`$argon2id$v=19$${PARAMS_TAG}$`);

let dummy: Promise<string> | undefined;
/** Hash verified for unknown emails, so timing doesn't reveal whether an account exists. */
export const dummyHash = () => (dummy ??= hashPassword("dummy password for timing equalisation"));

const LIST = fileURLToPath(new URL("../../assets/common-passwords.txt", import.meta.url));
let common: Set<string> | undefined;
export function isCommonPassword(pw: string): boolean {
  common ??= new Set(readFileSync(LIST, "utf8").split("\n").filter(Boolean));
  return common.has(normalizePassword(pw).toLowerCase());
}
