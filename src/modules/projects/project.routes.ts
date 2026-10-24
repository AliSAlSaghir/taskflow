import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectController,
  listProjectsController,
} from "./project.controller.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, createProjectController);
projectRouter.get("/", requireAuth, listProjectsController);

export { projectRouter };
