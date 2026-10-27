import type { RequestHandler } from "express";
import { projectIdSchema } from "../projects/project.schema.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from "./comment.schema.js";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentProjectNotFoundError,
  CommentResourceArchivedError,
  CommentTaskNotFoundError,
} from "./comment.errors.js";
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from "./comment.service.js";

function sendValidationError(
  res: Parameters<RequestHandler>[1],
  details: { field: string; message: string }[],
) {
  res.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      details,
    },
  });
}

function sendNotFound(res: Parameters<RequestHandler>[1]) {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    },
  });
}

function sendArchivedError(res: Parameters<RequestHandler>[1]) {
  res.status(409).json({
    error: {
      code: "COMMENT_RESOURCE_ARCHIVED",
      message: "Comments cannot be modified on archived resources.",
    },
  });
}

function validatePathIds(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
) {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);
  const taskIdResult = projectIdSchema.safeParse(req.params.taskId);
  const commentIdResult =
    req.params.commentId === undefined
      ? undefined
      : projectIdSchema.safeParse(req.params.commentId);

  const details = [
    ...(!projectIdResult.success
      ? projectIdResult.error.issues.map((issue) => ({
          field: "projectId",
          message: issue.message,
        }))
      : typeof projectIdResult.data !== "string"
        ? [{ field: "projectId", message: "Project ID is required." }]
        : []),
    ...(!taskIdResult.success
      ? taskIdResult.error.issues.map((issue) => ({
          field: "taskId",
          message: issue.message,
        }))
      : typeof taskIdResult.data !== "string"
        ? [{ field: "taskId", message: "Task ID is required." }]
        : []),
    ...(commentIdResult && !commentIdResult.success
      ? commentIdResult.error.issues.map((issue) => ({
          field: "commentId",
          message: issue.message,
        }))
      : commentIdResult && typeof commentIdResult.data !== "string"
        ? [{ field: "commentId", message: "Comment ID is required." }]
        : []),
  ];

  if (details.length > 0) {
    sendValidationError(res, details);
    return null;
  }

  if (
    !projectIdResult.success ||
    typeof projectIdResult.data !== "string" ||
    !taskIdResult.success ||
    typeof taskIdResult.data !== "string" ||
    (commentIdResult &&
      (!commentIdResult.success || typeof commentIdResult.data !== "string"))
  ) {
    return null;
  }

  return {
    projectId: projectIdResult.data,
    taskId: taskIdResult.data,
    ...(commentIdResult && {
      commentId: commentIdResult.data,
    }),
  };
}

function handleCommentError(
  error: unknown,
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
) {
  if (
    error instanceof CommentProjectNotFoundError ||
    error instanceof CommentTaskNotFoundError ||
    error instanceof CommentNotFoundError
  ) {
    sendNotFound(res);
    return;
  }

  if (error instanceof CommentForbiddenError) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof CommentResourceArchivedError) {
    sendArchivedError(res);
    return;
  }

  next(error);
}

export const createCommentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids) return;

  const bodyResult = createCommentSchema.safeParse(req.body);
  if (!bodyResult.success) {
    sendValidationError(
      res,
      bodyResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
    return;
  }

  try {
    const comment = await createComment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      bodyResult.data,
    );

    res.status(201).json({ data: comment });
  } catch (error: unknown) {
    handleCommentError(error, res, next);
  }
};

export const listCommentsController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids) return;

  const queryResult = listCommentsQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    sendValidationError(
      res,
      queryResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
    return;
  }

  try {
    const result = await listComments(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      queryResult.data,
    );

    res.status(200).json(result);
  } catch (error: unknown) {
    handleCommentError(error, res, next);
  }
};

export const updateCommentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids || !("commentId" in ids)) return;

  const bodyResult = updateCommentSchema.safeParse(req.body);
  if (!bodyResult.success) {
    sendValidationError(
      res,
      bodyResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    );
    return;
  }

  try {
    const comment = await updateComment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      ids.commentId,
      bodyResult.data,
    );

    res.status(200).json({ data: comment });
  } catch (error: unknown) {
    handleCommentError(error, res, next);
  }
};

export const deleteCommentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids || !("commentId" in ids)) return;

  try {
    const comment = await deleteComment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      ids.commentId,
    );

    res.status(200).json({ data: comment });
  } catch (error: unknown) {
    handleCommentError(error, res, next);
  }
};
