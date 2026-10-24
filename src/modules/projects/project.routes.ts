import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { createProjectController } from "./project.controller.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, createProjectController);

export { projectRouter };
