import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { updateProfile } from "./profile.controller.js";

const profileRouter = Router();

profileRouter.patch("/", requireAuth, updateProfile);

export { profileRouter };
