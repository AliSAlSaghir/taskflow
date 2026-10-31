import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  deleteProfilePictureController,
  getProfilePictureController,
  handleProfilePictureUploadError,
  profilePictureUpload,
  uploadProfilePictureController,
} from "./profile.controller.js";
import { updateProfile } from "./profile.controller.js";
import { requireCsrfToken } from "../../app/middleware/require-csrf-token.js";

const profileRouter = Router();

profileRouter.patch("/", requireAuth, requireCsrfToken, updateProfile);

profileRouter.put(
  "/picture",
  requireAuth,
  requireCsrfToken,
  profilePictureUpload.single("file"),
  uploadProfilePictureController,
);

profileRouter.get("/:userId/picture", requireAuth, getProfilePictureController);

profileRouter.delete(
  "/picture",
  requireAuth,
  requireCsrfToken,
  deleteProfilePictureController,
);

profileRouter.use(handleProfilePictureUploadError);

export { profileRouter };
