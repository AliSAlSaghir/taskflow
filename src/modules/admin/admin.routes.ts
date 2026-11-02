import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireAdmin } from "../auth/require-admin.middleware.js";
import {
  deactivateAdminUserController,
  getAdminProjectController,
  getAdminUserController,
  listAdminProjectsController,
  listAdminUsersController,
  reactivateAdminUserController,
} from "./admin.controller.js";
import { requireCsrfToken } from "../../app/middleware/require-csrf-token.js";

const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/users", listAdminUsersController);
adminRouter.get("/users/:userId", getAdminUserController);
adminRouter.get("/projects", listAdminProjectsController);
adminRouter.get("/projects/:projectId", getAdminProjectController);
adminRouter.patch(
  "/users/:userId/deactivate",
  requireCsrfToken,
  deactivateAdminUserController,
);

adminRouter.patch(
  "/users/:userId/reactivate",
  requireCsrfToken,
  reactivateAdminUserController,
);

export { adminRouter };
