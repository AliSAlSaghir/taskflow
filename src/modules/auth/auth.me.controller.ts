import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";

export const getCurrentUser: RequestHandler = async (_req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: res.locals.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            displayName: true,
            bio: true,
            profilePictureKey: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required.",
        },
      });
      return;
    }

    res.status(200).json({
      data: {
        userId: user.id,
        ...user,
      },
    });
  } catch (error: unknown) {
    next(error);
  }
};
