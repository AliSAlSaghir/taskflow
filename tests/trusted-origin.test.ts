import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Trusted origin middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows requests from the configured frontend", async () => {
    vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
    vi.resetModules();

    const { requireTrustedOrigin } =
      await import("../src/app/middleware/require-trusted-origin.js");

    const app = express();
    app.use(requireTrustedOrigin);
    app.post("/test", (_req, res) => res.sendStatus(200));

    const response = await request(app)
      .post("/test")
      .set("Origin", "http://localhost:5173");

    expect(response.status).toBe(200);
  });

  it("rejects requests from an untrusted origin", async () => {
    vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
    vi.resetModules();

    const { requireTrustedOrigin } =
      await import("../src/app/middleware/require-trusted-origin.js");

    const app = express();
    app.use(requireTrustedOrigin);
    app.post("/test", (_req, res) => res.sendStatus(200));

    const response = await request(app)
      .post("/test")
      .set("Origin", "https://untrusted.example");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INVALID_ORIGIN");
  });

  it("allows requests without Origin outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FRONTEND_ORIGIN", "http://localhost:5173");
    vi.resetModules();

    const { requireTrustedOrigin } =
      await import("../src/app/middleware/require-trusted-origin.js");

    const app = express();
    app.use(requireTrustedOrigin);
    app.post("/test", (_req, res) => res.sendStatus(200));

    const response = await request(app).post("/test");

    expect(response.status).toBe(200);
  });

  it("rejects requests without Origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", "https://taskflow-frontend.onrender.com");
    vi.stubEnv("B2_KEY_ID", "test-key-id");
    vi.stubEnv("B2_APPLICATION_KEY", "test-application-key");
    vi.stubEnv("B2_BUCKET_NAME", "test-bucket");
    vi.stubEnv("B2_REGION", "eu-central-003");
    vi.stubEnv("B2_ENDPOINT", "https://s3.eu-central-003.backblazeb2.com");
    vi.resetModules();

    const { requireTrustedOrigin } =
      await import("../src/app/middleware/require-trusted-origin.js");

    const app = express();
    app.use(requireTrustedOrigin);
    app.post("/test", (_req, res) => res.sendStatus(200));

    const response = await request(app).post("/test");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INVALID_ORIGIN");
  });
});
