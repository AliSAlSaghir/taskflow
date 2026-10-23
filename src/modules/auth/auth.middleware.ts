import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";
import { verifyAccessToken } from "./token.service.js";

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.access_token;

  if (typeof token !== "string" || token.length === 0) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
      },
    });
    return;
  }

  let identity: { userId: string; sessionId: string };

  try {
    identity = await verifyAccessToken(token);
  } catch {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required.",
      },
    });
    return;
  }

  try {
    const now = new Date();

    const [user, session] = await Promise.all([
      prisma.user.findUnique({
        where: { id: identity.userId },
        select: { id: true, status: true },
      }),
      prisma.authSession.findFirst({
        where: {
          id: identity.sessionId,
          userId: identity.userId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);

    if (!user || user.status !== "ACTIVE" || !session) {
      res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
        },
      });
      return;
    }

    res.locals.user = {
      id: user.id,
      sessionId: session.id,
    };
    next();
  } catch (error: unknown) {
    next(error);
  }
};
