import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";

type RateLimitOptions = {
  windowMs: number;
  limit: number;
  message: string;
};

export function createRateLimiter({
  windowMs,
  limit,
  message,
}: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message,
      },
    },
  });
}

const isTest = env.NODE_ENV === "test";

export const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 1_000 : 10,
  message: "Too many login attempts. Please try again later.",
});

export const registrationRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: isTest ? 1_000 : 5,
  message: "Too many registration attempts. Please try again later.",
});
