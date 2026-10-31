import type { RequestHandler } from "express";
import { verifyCsrfToken } from "../../modules/auth/csrf.service.js";

export const requireCsrfToken: RequestHandler = (req, res, next) => {
  const sessionId = res.locals.user?.sessionId;
  const csrfToken = req.get("X-CSRF-Token");

  if (typeof sessionId !== "string" || !verifyCsrfToken(sessionId, csrfToken)) {
    res.status(403).json({
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "CSRF token is missing or invalid.",
      },
    });
    return;
  }

  next();
};
