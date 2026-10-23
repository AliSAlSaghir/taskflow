import type { Request, Response, NextFunction } from "express";
import { loginSchema, registerSchema } from "./auth.schema.js";
import { loginUser, registerUser } from "./auth.service.js";
import { EmailAlreadyRegisteredError } from "./auth.errors.js";
import { env } from "../../config/env.js";
import { createAccessToken } from "./token.service.js";
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  REFRESH_TOKEN_LIFETIME_MS,
} from "./auth.constants.js";
import {
  createAuthSession,
  revokeAllAuthSessions,
  revokeAuthSession,
  rotateRefreshToken,
} from "./session.service.js";

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

export async function login(req: Request, res: Response, next: NextFunction) {
  const result = loginSchema.safeParse(req.body);

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
    const user = await loginUser(result.data);

    if (!user) {
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password.",
        },
      });
    }

    const { sessionId, refreshToken } = await createAuthSession(user.id);
    const accessToken = await createAccessToken(user.id, sessionId);

    const cookieOptions = {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax" as const,
    };

    res.cookie("access_token", accessToken, {
      ...cookieOptions,
      path: "/",
      maxAge: ACCESS_TOKEN_LIFETIME_SECONDS * 1000,
    });

    res.cookie("refresh_token", refreshToken, {
      ...cookieOptions,
      path: "/api/v1/auth",
      maxAge: REFRESH_TOKEN_LIFETIME_MS,
    });

    return res.status(200).json({
      data: user,
    });
  } catch (error: unknown) {
    return next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  const rawToken = req.cookies?.refresh_token;

  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  const clearAuthCookies = () => {
    res.clearCookie("access_token", {
      ...cookieOptions,
      path: "/",
    });

    res.clearCookie("refresh_token", {
      ...cookieOptions,
      path: "/api/v1/auth",
    });
  };

  if (typeof rawToken !== "string" || rawToken.length === 0) {
    clearAuthCookies();

    return res.status(401).json({
      error: {
        code: "INVALID_REFRESH_TOKEN",
        message: "A valid refresh token is required.",
      },
    });
  }

  try {
    const result = await rotateRefreshToken(rawToken);

    if (result.kind !== "rotated") {
      clearAuthCookies();

      return res.status(401).json({
        error: {
          code: "INVALID_REFRESH_TOKEN",
          message: "A valid refresh token is required.",
        },
      });
    }

    const accessToken = await createAccessToken(
      result.userId,
      result.sessionId,
    );

    res.cookie("access_token", accessToken, {
      ...cookieOptions,
      path: "/",
      maxAge: ACCESS_TOKEN_LIFETIME_SECONDS * 1000,
    });

    res.cookie("refresh_token", result.refreshToken, {
      ...cookieOptions,
      path: "/api/v1/auth",
      maxAge: REFRESH_TOKEN_LIFETIME_MS,
    });

    return res.status(200).json({
      data: { refreshed: true },
    });
  } catch (error: unknown) {
    return next(error);
  }
}

export async function logout(_req: Request, res: Response, next: NextFunction) {
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  try {
    await revokeAuthSession(res.locals.user.id, res.locals.user.sessionId);

    res.clearCookie("access_token", {
      ...cookieOptions,
      path: "/",
    });

    res.clearCookie("refresh_token", {
      ...cookieOptions,
      path: "/api/v1/auth",
    });

    return res.status(200).json({
      data: { loggedOut: true },
    });
  } catch (error: unknown) {
    return next(error);
  }
}

export async function logoutAll(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  const cookieOptions = {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };

  try {
    await revokeAllAuthSessions(res.locals.user.id);

    res.clearCookie("access_token", {
      ...cookieOptions,
      path: "/",
    });

    res.clearCookie("refresh_token", {
      ...cookieOptions,
      path: "/api/v1/auth",
    });

    return res.status(200).json({
      data: { loggedOut: true, allSessionsRevoked: true },
    });
  } catch (error: unknown) {
    return next(error);
  }
}
