import type { Request, Response, NextFunction } from "express";
import { registerSchema } from "./auth.schema.js";
import { registerUser } from "./auth.service.js";
import { EmailAlreadyRegisteredError } from "./auth.errors.js";

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const result = registerSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  try {
    const user = await registerUser(result.data);

    return res.status(201).json({
      data: user,
    });
  } catch (error: unknown) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return res.status(409).json({
        error: {
          code: "EMAIL_ALREADY_REGISTERED",
          message: error.message,
        },
      });
    }

    return next(error);
  }
}
