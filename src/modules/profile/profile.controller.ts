import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/database/prisma.js";
import { updateProfileSchema } from "./profile.schema.js";

export const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid profile update.",
          details: parsed.error.issues,
        },
      });
      return;
    }

    const profile = await prisma.profile.update({
      where: { userId: res.locals.user.id },
      data: {
        ...(parsed.data.displayName === undefined
          ? {}
          : { displayName: parsed.data.displayName }),
        ...(parsed.data.bio === undefined ? {} : { bio: parsed.data.bio }),
      },
      select: {
        displayName: true,
        bio: true,
        profilePictureKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ data: { profile } });
  } catch (error: unknown) {
    next(error);
  }
};
