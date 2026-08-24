import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUTH_SECRET ?? "dev-only-change-me";

/** scrypt with a per-user salt. Format: salt:hash, both hex. */
export function hashPassword(plain: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

/**
 * Minimal signed token: base64(payload).hmac
 *
 * Enough to stop tampering for a demo. Swap for a real JWT library plus
 * rotation and revocation before this handles anyone's actual account.
 */
export function signToken(payload: object, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, exp: Date.now() + ttlSeconds * 1000 };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken<T = Record<string, unknown>>(token?: string): T | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  const expected = createHmac("sha256", SECRET).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(data, "base64url").toString());
    if (typeof body.exp !== "number" || body.exp < Date.now()) return null;
    return body as T;
  } catch {
    return null;
  }
}

/** Short human-readable pickup code, e.g. "NT-7F3K2Q". */
export function makeOrderCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `NT-${out}`;
}
