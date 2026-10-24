import type { RequestHandler } from "express";
import {
  createProjectSchema,
  listProjectsQuerySchema,
} from "./project.schema.js";
import { createProject, listProjects } from "./project.service.js";

export const createProjectController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const result = createProjectSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const project = await createProject(res.locals.user.id, result.data);

    res.status(201).json({
      data: project,
    });
  } catch (error: unknown) {
    next(error);
  }
};

export const listProjectsController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const result = listProjectsQuerySchema.safeParse(req.query);

  if (!result.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const resultData = await listProjects(res.locals.user.id, result.data);

    res.status(200).json(resultData);
  } catch (error: unknown) {
    next(error);
  }
};
