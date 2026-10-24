import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectController,
  listProjectsController,
  getProjectController,
} from "./project.controller.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, createProjectController);
projectRouter.get("/", requireAuth, listProjectsController);
projectRouter.get("/:projectId", requireAuth, getProjectController);

export { projectRouter };
