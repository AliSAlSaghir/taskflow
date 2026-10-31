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
import {
  archiveTaskController,
  assignLabelToTaskController,
  createTaskController,
  getTaskController,
  listTasksController,
  removeLabelFromTaskController,
  restoreTaskController,
  updateTaskController,
} from "../tasks/task.controller.js";
import {
  createLabelController,
  deleteLabelController,
  listLabelsController,
} from "../labels/label.controller.js";
import {
  createCommentController,
  deleteCommentController,
  listCommentsController,
  updateCommentController,
} from "../comments/comment.controller.js";

import {
  attachmentUpload,
  deleteAttachmentController,
  downloadAttachmentController,
  handleAttachmentUploadError,
  listAttachmentsController,
  uploadAttachmentController,
} from "../attachments/attachment.controller.js";
import { requireCsrfToken } from "../../app/middleware/require-csrf-token.js";

const projectRouter = Router();

projectRouter.post("/", requireAuth, requireCsrfToken, createProjectController);
projectRouter.get("/", requireAuth, listProjectsController);
projectRouter.get("/:projectId", requireAuth, getProjectController);
projectRouter.patch(
  "/:projectId",
  requireAuth,
  requireCsrfToken,
  updateProjectController,
);
projectRouter.delete(
  "/:projectId",
  requireAuth,
  requireCsrfToken,
  archiveProjectController,
);
projectRouter.post(
  "/:projectId/unarchive",
  requireAuth,
  requireCsrfToken,
  unarchiveProjectController,
);

projectRouter.post(
  "/:projectId/members",
  requireAuth,
  requireCsrfToken,
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
  requireCsrfToken,
  removeProjectMemberController,
);

projectRouter.post(
  "/:projectId/tasks",
  requireAuth,
  requireCsrfToken,
  createTaskController,
);
projectRouter.get("/:projectId/tasks", requireAuth, listTasksController);
projectRouter.get("/:projectId/tasks/:taskId", requireAuth, getTaskController);
projectRouter.patch(
  "/:projectId/tasks/:taskId",
  requireAuth,
  requireCsrfToken,
  updateTaskController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId",
  requireAuth,
  requireCsrfToken,
  archiveTaskController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/restore",
  requireAuth,
  requireCsrfToken,
  restoreTaskController,
);

projectRouter.post(
  "/:projectId/labels",
  requireAuth,
  requireCsrfToken,
  createLabelController,
);

projectRouter.get("/:projectId/labels", requireAuth, listLabelsController);

projectRouter.delete(
  "/:projectId/labels/:labelId",
  requireAuth,
  requireCsrfToken,
  deleteLabelController,
);

projectRouter.put(
  "/:projectId/tasks/:taskId/labels/:labelId",
  requireAuth,
  requireCsrfToken,
  assignLabelToTaskController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId/labels/:labelId",
  requireAuth,
  requireCsrfToken,
  removeLabelFromTaskController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/comments",
  requireAuth,
  requireCsrfToken,
  createCommentController,
);

projectRouter.get(
  "/:projectId/tasks/:taskId/comments",
  requireAuth,
  listCommentsController,
);

projectRouter.patch(
  "/:projectId/tasks/:taskId/comments/:commentId",
  requireAuth,
  requireCsrfToken,
  updateCommentController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId/comments/:commentId",
  requireAuth,
  requireCsrfToken,
  deleteCommentController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/attachments",
  requireAuth,
  requireCsrfToken,
  attachmentUpload.single("file"),
  handleAttachmentUploadError,
  uploadAttachmentController,
);

projectRouter.get(
  "/:projectId/tasks/:taskId/attachments",
  requireAuth,
  listAttachmentsController,
);

projectRouter.get(
  "/:projectId/tasks/:taskId/attachments/:attachmentId",
  requireAuth,
  downloadAttachmentController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId/attachments/:attachmentId",
  requireAuth,
  requireCsrfToken,
  deleteAttachmentController,
);

export { projectRouter };
