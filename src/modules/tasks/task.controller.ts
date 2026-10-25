import type { RequestHandler } from "express";
import { projectIdSchema } from "../projects/project.schema.js";
import { createTaskSchema, listTasksQuerySchema } from "./task.schema.js";
import {
  ProjectNotFoundError,
  TaskAssigneeNotEligibleError,
} from "./task.errors.js";
import { createTask, listTasks } from "./task.service.js";

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
