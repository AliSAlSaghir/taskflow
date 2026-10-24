import type { RequestHandler } from "express";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdSchema,
} from "./project.schema.js";
import { createProject, listProjects, getProject } from "./project.service.js";

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

export const getProjectController: RequestHandler = async (req, res, next) => {
  const result = projectIdSchema.safeParse(req.params.projectId);

  if (!result.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: result.error.issues.map((issue) => ({
          field: "projectId",
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const project = await getProject(res.locals.user.id, result.data);

    if (!project) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    res.status(200).json({ data: project });
  } catch (error: unknown) {
    next(error);
  }
};
