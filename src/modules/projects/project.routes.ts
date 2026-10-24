import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectController,
  listProjectsController,
  getProjectController,
  updateProjectController,
} from "./project.controller.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, createProjectController);
projectRouter.get("/", requireAuth, listProjectsController);
projectRouter.get("/:projectId", requireAuth, getProjectController);
projectRouter.patch("/:projectId", requireAuth, updateProjectController);

export { projectRouter };
