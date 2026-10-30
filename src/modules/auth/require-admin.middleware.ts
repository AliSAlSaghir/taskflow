import type { RequestHandler } from "express";

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.user.role !== "ADMIN") {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Administrator access is required.",
      },
    });
    return;
  }

  next();
};
