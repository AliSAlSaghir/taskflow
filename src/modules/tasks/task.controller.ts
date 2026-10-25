import type { RequestHandler } from "express";
import { projectIdSchema } from "../projects/project.schema.js";
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "./task.schema.js";
import {
  ProjectNotFoundError,
  TaskAssigneeNotEligibleError,
  TaskNotFoundError,
  TaskUpdateForbiddenError,
} from "./task.errors.js";
import {
  archiveTask,
  createTask,
  listTasks,
  restoreTask,
  updateTask,
} from "./task.service.js";

export const createTaskController: RequestHandler = async (req, res, next) => {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);

  if (!projectIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: projectIdResult.error.issues.map((issue) => ({
          field: "projectId",
          message: issue.message,
        })),
      },
    });
    return;
  }

  const bodyResult = createTaskSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: bodyResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const task = await createTask(
      res.locals.user.id,
      projectIdResult.data,
      bodyResult.data,
    );

    res.status(201).json({ data: task });
  } catch (error: unknown) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof TaskAssigneeNotEligibleError
    ) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    next(error);
  }
};

export const listTasksController: RequestHandler = async (req, res, next) => {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);

  if (!projectIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: projectIdResult.error.issues.map((issue) => ({
          field: "projectId",
          message: issue.message,
        })),
      },
    });
    return;
  }

  const queryResult = listTasksQuerySchema.safeParse(req.query);

  if (!queryResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: queryResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const result = await listTasks(
      res.locals.user.id,
      projectIdResult.data,
      queryResult.data,
    );

    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof ProjectNotFoundError) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    next(error);
  }
};

export const updateTaskController: RequestHandler = async (req, res, next) => {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);

  if (!projectIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: projectIdResult.error.issues.map((issue) => ({
          field: "projectId",
          message: issue.message,
        })),
      },
    });
    return;
  }

  const taskIdResult = projectIdSchema.safeParse(req.params.taskId);

  if (!taskIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: taskIdResult.error.issues.map((issue) => ({
          field: "taskId",
          message: issue.message,
        })),
      },
    });
    return;
  }

  const bodyResult = updateTaskSchema.safeParse(req.body);

  if (!bodyResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: bodyResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const task = await updateTask(
      res.locals.user.id,
      projectIdResult.data,
      taskIdResult.data,
      bodyResult.data,
    );

    res.status(200).json({ data: task });
  } catch (error: unknown) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof TaskNotFoundError ||
      error instanceof TaskAssigneeNotEligibleError
    ) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    if (error instanceof TaskUpdateForbiddenError) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You are not allowed to update this task.",
        },
      });
      return;
    }

    next(error);
  }
};

export const archiveTaskController: RequestHandler = async (req, res, next) => {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);
  const taskIdResult = projectIdSchema.safeParse(req.params.taskId);

  if (!projectIdResult.success || !taskIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: [
          ...(!projectIdResult.success
            ? projectIdResult.error.issues.map((issue) => ({
                field: "projectId",
                message: issue.message,
              }))
            : []),
          ...(!taskIdResult.success
            ? taskIdResult.error.issues.map((issue) => ({
                field: "taskId",
                message: issue.message,
              }))
            : []),
        ],
      },
    });
    return;
  }

  try {
    const task = await archiveTask(
      res.locals.user.id,
      projectIdResult.data,
      taskIdResult.data,
    );

    res.status(200).json({ data: task });
  } catch (error: unknown) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof TaskNotFoundError
    ) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    next(error);
  }
};

export const restoreTaskController: RequestHandler = async (req, res, next) => {
  const projectIdResult = projectIdSchema.safeParse(req.params.projectId);
  const taskIdResult = projectIdSchema.safeParse(req.params.taskId);

  if (!projectIdResult.success || !taskIdResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: [
          ...(!projectIdResult.success
            ? projectIdResult.error.issues.map((issue) => ({
                field: "projectId",
                message: issue.message,
              }))
            : []),
          ...(!taskIdResult.success
            ? taskIdResult.error.issues.map((issue) => ({
                field: "taskId",
                message: issue.message,
              }))
            : []),
        ],
      },
    });
    return;
  }

  try {
    const task = await restoreTask(
      res.locals.user.id,
      projectIdResult.data,
      taskIdResult.data,
    );

    res.status(200).json({ data: task });
  } catch (error: unknown) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof TaskNotFoundError
    ) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    next(error);
  }
};
