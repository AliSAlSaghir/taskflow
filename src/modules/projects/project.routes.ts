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
projectRouter.get("/:projectId/tasks", requireAuth, listTasksController);
projectRouter.get("/:projectId/tasks/:taskId", requireAuth, getTaskController);
projectRouter.patch(
  "/:projectId/tasks/:taskId",
  requireAuth,
  updateTaskController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId",
  requireAuth,
  archiveTaskController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/restore",
  requireAuth,
  restoreTaskController,
);

projectRouter.post("/:projectId/labels", requireAuth, createLabelController);

projectRouter.get("/:projectId/labels", requireAuth, listLabelsController);

projectRouter.delete(
  "/:projectId/labels/:labelId",
  requireAuth,
  deleteLabelController,
);

projectRouter.put(
  "/:projectId/tasks/:taskId/labels/:labelId",
  requireAuth,
  assignLabelToTaskController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId/labels/:labelId",
  requireAuth,
  removeLabelFromTaskController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/comments",
  requireAuth,
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
  updateCommentController,
);

projectRouter.delete(
  "/:projectId/tasks/:taskId/comments/:commentId",
  requireAuth,
  deleteCommentController,
);

projectRouter.post(
  "/:projectId/tasks/:taskId/attachments",
  requireAuth,
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
  deleteAttachmentController,
);

export { projectRouter };
