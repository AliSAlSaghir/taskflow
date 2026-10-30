import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireAdmin } from "../auth/require-admin.middleware.js";
import {
  getAdminProjectController,
  getAdminUserController,
  listAdminProjectsController,
  listAdminUsersController,
} from "./admin.controller.js";

const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", listAdminUsersController);
adminRouter.get("/users/:userId", getAdminUserController);
adminRouter.get("/projects", listAdminProjectsController);
adminRouter.get("/projects/:projectId", getAdminProjectController);

export { adminRouter };
