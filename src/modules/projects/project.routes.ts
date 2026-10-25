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
import {
  addProjectMemberController,
  listProjectMembersController,
  removeProjectMemberController,
} from "./membership.controller.js";
import { createTaskController } from "../tasks/task.controller.js";

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
projectRouter.get(
  "/:projectId/members",
  requireAuth,
  listProjectMembersController,
);
projectRouter.delete(
  "/:projectId/members/:membershipId",
  requireAuth,
  removeProjectMemberController,
);

projectRouter.post("/:projectId/tasks", requireAuth, createTaskController);

export { projectRouter };
