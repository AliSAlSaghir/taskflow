import type { RequestHandler } from "express";
import { env } from "../../config/env.js";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (!unsafeMethods.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("Origin");

  // Non-browser clients may omit Origin.
  if (!origin && env.NODE_ENV !== "production") {
    next();
    return;
  }

  if (!origin || origin !== env.FRONTEND_ORIGIN) {
    res.status(403).json({
      error: {
        code: "INVALID_ORIGIN",
        message: "Request origin is not allowed.",
      },
    });
    return;
  }

  next();
};
