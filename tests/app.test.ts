import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app/app.js";

describe("GET /health", () => {
  it("returns HTTP 200 and a healthy status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
    });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("confirms the database is reachable", async () => {
    const response = await request(app).get("/health/ready");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      database: "connected",
    });
  });
});
