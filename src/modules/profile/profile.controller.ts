import type { RequestHandler, ErrorRequestHandler } from "express";
import { updateProfileSchema } from "./profile.schema.js";
import multer, { MulterError } from "multer";
import {
  updateProfileService,
  deleteProfilePicture,
  getProfilePicture,
  uploadProfilePicture,
} from "./profile.service.js";
import {
  ProfileNotFoundError,
  ProfilePictureNotFoundError,
  ProfileStorageError,
  ProfileValidationError,
} from "./profile.errors.js";
import { z } from "zod";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export const updateProfile: RequestHandler = async (req, res, next) => {
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

  try {
    const profile = await updateProfileService(res.locals.user.id, parsed.data);

    res.status(200).json({ data: { profile } });
  } catch (error: unknown) {
    handleProfileError(error, res, next);
  }
};

export const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

function sendValidationError(
  res: Parameters<RequestHandler>[1],
  message: string,
) {
  res.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      details: [{ field: "file", message }],
    },
  });
}

function handleProfileError(
  error: unknown,
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
) {
  if (error instanceof ProfileNotFoundError) {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: error.message },
    });
    return;
  }

  if (error instanceof ProfilePictureNotFoundError) {
    res.status(404).json({
      error: { code: "PROFILE_PICTURE_NOT_FOUND", message: error.message },
    });
    return;
  }

  if (error instanceof ProfileValidationError) {
    sendValidationError(res, error.message);
    return;
  }

  if (error instanceof ProfileStorageError) {
    res.status(502).json({
      error: { code: "PROFILE_STORAGE_ERROR", message: error.message },
    });
    return;
  }

  next(error);
}

export const uploadProfilePictureController: RequestHandler = async (
  req,
  res,
  next,
) => {
  if (!req.file) {
    sendValidationError(res, "An image is required.");
    return;
  }

  try {
    const profile = await uploadProfilePicture(res.locals.user.id, req.file);

    res.status(200).json({ data: { profile } });
  } catch (error: unknown) {
    handleProfileError(error, res, next);
  }
};

export const getProfilePictureController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const parsedUserId = z.string().uuid().safeParse(req.params.userId);

  if (!parsedUserId.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid user ID.",
      },
    });
    return;
  }

  const userId = parsedUserId.data;

  try {
    const picture = await getProfilePicture(userId);

    res.setHeader(
      "Content-Type",
      picture.contentType ?? "application/octet-stream",
    );
    res.setHeader("Content-Length", picture.body.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(picture.body);
  } catch (error: unknown) {
    handleProfileError(error, res, next);
  }
};

export const deleteProfilePictureController: RequestHandler = async (
  _req,
  res,
  next,
) => {
  try {
    const result = await deleteProfilePicture(res.locals.user.id);

    res.status(200).json({ data: result });
  } catch (error: unknown) {
    handleProfileError(error, res, next);
  }
};

export const handleProfilePictureUploadError: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendValidationError(res, "The image must be no larger than 2 MB.");
      return;
    }

    sendValidationError(res, "The uploaded image request is invalid.");
    return;
  }

  next(error);
};
