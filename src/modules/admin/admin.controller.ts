import type { Request, RequestHandler, Response } from "express";
import {
  adminUserIdSchema,
  listAdminUsersQuerySchema,
  adminProjectIdSchema,
  listAdminProjectsQuerySchema,
} from "./admin.schema.js";
import {
  getAdminUser,
  listAdminUsers,
  getAdminProject,
  listAdminProjects,
} from "./admin.service.js";

export const listAdminUsersController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const parsed = listAdminUsersQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid user listing query.",
        details: parsed.error.issues,
      },
    });
    return;
  }

  try {
    const result = await listAdminUsers(parsed.data);
    res.status(200).json(result);
  } catch (error: unknown) {
    next(error);
  }
};

export const getAdminUserController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const parsed = adminUserIdSchema.safeParse(req.params.userId);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid user ID.",
        details: parsed.error.issues,
      },
    });
    return;
  }

  try {
    const user = await getAdminUser(parsed.data);

    if (!user) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "User not found.",
        },
      });
      return;
    }

    res.status(200).json({ data: { user } });
  } catch (error: unknown) {
    next(error);
  }
};

export async function listAdminProjectsController(req: Request, res: Response) {
  const parsed = listAdminProjectsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters.",
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  const result = await listAdminProjects(parsed.data);

  res.status(200).json(result);
}

export async function getAdminProjectController(req: Request, res: Response) {
  const parsed = adminProjectIdSchema.safeParse(req.params.projectId);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid project ID.",
      },
    });
    return;
  }

  const project = await getAdminProject(parsed.data);

  if (!project) {
    res.status(404).json({
      error: {
        code: "PROJECT_NOT_FOUND",
        message: "Project not found.",
      },
    });
    return;
  }

  res.status(200).json({
    data: {
      project,
    },
  });
}
