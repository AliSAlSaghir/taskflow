import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("CORS configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows the configured frontend origin with credentials", async () => {
    vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
    vi.resetModules();

    const { app } = await import("../src/app/app.js");

    const response = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant CORS permission to an untrusted origin", async () => {
    vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
    vi.resetModules();

    const { app } = await import("../src/app/app.js");

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
