import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createProjectController,
  listProjectsController,
  getProjectController,
  updateProjectController,
  archiveProjectController,
  unarchiveProjectController,
} from "./project.controller.js";
import { addProjectMemberController } from "./membership.controller.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, createProjectController);
projectRouter.get("/", requireAuth, listProjectsController);
projectRouter.get("/:projectId", requireAuth, getProjectController);
projectRouter.patch("/:projectId", requireAuth, updateProjectController);
projectRouter.delete("/:projectId", requireAuth, archiveProjectController);
projectRouter.post(
  "/:projectId/unarchive",
  requireAuth,
  unarchiveProjectController,
);

projectRouter.post(
  "/:projectId/members",
  requireAuth,
  addProjectMemberController,
);

export { projectRouter };
