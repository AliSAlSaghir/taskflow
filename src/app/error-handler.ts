import type { ErrorRequestHandler } from "express";
import { logger } from "./logger.js";

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  ) {
    res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON.",
      },
    });
    return;
  }

  const requestId = res.locals.requestId as string | undefined;

  logger.error("Unhandled request error", {
    ...(requestId ? { requestId } : {}),
    method: req.method,
    path: req.path,
    error,
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      ...(requestId ? { requestId } : {}),
    },
  });
};
