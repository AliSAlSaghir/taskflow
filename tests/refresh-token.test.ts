import { describe, expect, it } from "vitest";
import {
  createRefreshToken,
  hashRefreshToken,
} from "../src/modules/auth/refresh-token.service.js";

describe("refresh-token service", () => {
  it("generates unique, URL-safe refresh tokens", () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first).toHaveLength(43);
    expect(second).not.toBe(first);
  });

  it("produces a consistent SHA-256 hash", () => {
    const token = createRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different tokens", () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(hashRefreshToken(first)).not.toBe(hashRefreshToken(second));
  });

  it("does not return the raw token as its hash", () => {
    const token = createRefreshToken();

    expect(hashRefreshToken(token)).not.toBe(token);
  });
});
