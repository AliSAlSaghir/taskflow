import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
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

  console.error("Unhandled request error:", {
    method: req.method,
    path: req.path,
    error,
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};
