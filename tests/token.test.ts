import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  createAccessToken,
  verifyAccessToken,
} from "../src/modules/auth/token.service.js";
import { env } from "../src/config/env.js";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const sessionId = "7f2d0c61-1b83-4a39-a8c2-9d3e4f5a6b70";

describe("access tokens", () => {
  it("creates a token and verifies the user and session IDs", async () => {
    const token = await createAccessToken(userId, sessionId);
    const payload = await verifyAccessToken(token);

    expect(typeof token).toBe("string");
    expect(payload).toEqual({ userId, sessionId });
  });

  it("rejects a malformed token", async () => {
    await expect(verifyAccessToken("not-a-valid-jwt")).rejects.toThrow();
  });

  it("rejects a token with a modified signature", async () => {
    const token = await createAccessToken(userId, sessionId);
    const [header, payload, signature] = token.split(".");

    if (!header || !payload || !signature) {
      throw new Error("Expected a JWT with three segments.");
    }

    const changedSignature =
      (signature[0] === "a" ? "b" : "a") + signature.slice(1);

    await expect(
      verifyAccessToken(`${header}.${payload}.${changedSignature}`),
    ).rejects.toThrow();
  });

  it("rejects a correctly signed token without a session ID", async () => {
    const secret = new TextEncoder().encode(env.ACCESS_TOKEN_SECRET);

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("taskflow-api")
      .setAudience("taskflow-client")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow(
      "Access token is missing its session ID.",
    );
  });
});
