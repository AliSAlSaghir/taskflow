import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/app/middleware/rate-limit.js";

describe("Rate limiting", () => {
  it("returns 429 when the request limit is exceeded", async () => {
    const testApp = express();

    const limiter = createRateLimiter({
      windowMs: 60_000,
      limit: 2,
      message: "Too many test requests. Please try again later.",
    });

    testApp.get("/limited", limiter, (_req, res) => {
      res.status(200).json({ status: "ok" });
    });

    const firstResponse = await request(testApp).get("/limited");
    const secondResponse = await request(testApp).get("/limited");
    const thirdResponse = await request(testApp).get("/limited");

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    expect(thirdResponse.status).toBe(429);
    expect(thirdResponse.body).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many test requests. Please try again later.",
      },
    });
  });
});
