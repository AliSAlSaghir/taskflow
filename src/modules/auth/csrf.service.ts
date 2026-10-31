import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export function createCsrfToken(sessionId: string): string {
  return createHmac("sha256", env.ACCESS_TOKEN_SECRET)
    .update(`taskflow-csrf:${sessionId}`)
    .digest("hex");
}

export function verifyCsrfToken(sessionId: string, token: unknown): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  const expectedToken = Buffer.from(createCsrfToken(sessionId), "hex");
  const suppliedToken = Buffer.from(token, "hex");

  return timingSafeEqual(expectedToken, suppliedToken);
}
