import { createHash, randomBytes } from "node:crypto";

/**
 * Creates an opaque refresh token using cryptographically secure randomness.
 *
 * The returned value is the raw token. Send it to the client only in an
 * HttpOnly cookie; store its hash in the database.
 */
export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hashes a raw refresh token before it is stored or looked up in the database.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
