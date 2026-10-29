import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app/app.js";
import express from "express";
import { errorHandler } from "../src/app/error-handler.js";

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

it("returns 400 for malformed JSON", async () => {
  const response = await request(app)
    .post("/api/v1/auth/register")
    .set("Content-Type", "application/json")
    .send('{"email":');

  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe("INVALID_JSON");
});

it("returns a consistent 404 for an unknown route", async () => {
  const response = await request(app).get("/route-that-does-not-exist");

  expect(response.status).toBe(404);
  expect(response.body).toEqual({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    },
  });
});

it("returns a generic 500 without exposing unexpected error details", async () => {
  const testApp = express();

  testApp.get("/test-unexpected-error", (_req, _res, next) => {
    next(new Error("Sensitive internal database details"));
  });

  testApp.use(errorHandler);

  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const response = await request(testApp).get("/test-unexpected-error");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });

    expect(JSON.stringify(response.body)).not.toContain(
      "Sensitive internal database details",
    );
  } finally {
    consoleError.mockRestore();
  }
});
