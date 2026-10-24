import type { RequestHandler } from "express";
import {
  addProjectMemberSchema,
  listProjectMembersQuerySchema,
  projectIdSchema,
} from "./project.schema.js";
import {
  MemberNotEligibleError,
  MembershipAlreadyExistsError,
  ProjectNotFoundError,
} from "./membership.errors.js";
import { addProjectMember, listProjectMembers } from "./membership.service.js";

export const addProjectMemberController: RequestHandler = async (
  req,
  res,
  next,
) => {
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

  const bodyResult = addProjectMemberSchema.safeParse(req.body);

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
    const membership = await addProjectMember(
      res.locals.user.id,
      projectIdResult.data,
      bodyResult.data.email,
    );

    res.status(201).json({ data: membership });
  } catch (error: unknown) {
    if (
      error instanceof ProjectNotFoundError ||
      error instanceof MemberNotEligibleError
    ) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "The requested resource was not found.",
        },
      });
      return;
    }

    if (error instanceof MembershipAlreadyExistsError) {
      res.status(409).json({
        error: {
          code: "MEMBERSHIP_ALREADY_EXISTS",
          message: "This user is already a member of the project.",
        },
      });
      return;
    }

    next(error);
  }
};

export const listProjectMembersController: RequestHandler = async (
  req,
  res,
  next,
) => {
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

  const queryResult = listProjectMembersQuerySchema.safeParse(req.query);

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
    const result = await listProjectMembers(
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
