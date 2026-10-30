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

const profileRouter = Router();

profileRouter.patch("/", requireAuth, updateProfile);

profileRouter.put(
  "/picture",
  requireAuth,
  profilePictureUpload.single("file"),
  uploadProfilePictureController,
);

profileRouter.get("/:userId/picture", requireAuth, getProfilePictureController);

profileRouter.delete("/picture", requireAuth, deleteProfilePictureController);

profileRouter.use(handleProfilePictureUploadError);

export { profileRouter };
