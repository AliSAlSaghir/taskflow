import type { RequestHandler } from "express";
import {
  createLabelSchema,
  labelParamsSchema,
  projectLabelParamsSchema,
} from "./label.schema.js";
import { createLabel, deleteLabel, listLabels } from "./label.service.js";
import {
  ArchivedProjectError,
  DuplicateLabelNameError,
  LabelNotFoundError,
  ProjectNotFoundError,
} from "./label.errors.js";

export const createLabelController: RequestHandler = async (req, res, next) => {
  const paramsResult = projectLabelParamsSchema.safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: paramsResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  const bodyResult = createLabelSchema.safeParse(req.body);

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
    const label = await createLabel(
      paramsResult.data.projectId,
      res.locals.user.id,
      bodyResult.data.name,
    );

    res.status(201).json({ data: label });
  } catch (error: unknown) {
    if (error instanceof DuplicateLabelNameError) {
      res.status(409).json({
        error: { code: "DUPLICATE_LABEL", message: error.message },
      });
      return;
    }

    if (error instanceof ArchivedProjectError) {
      res.status(409).json({
        error: { code: "PROJECT_ARCHIVED", message: error.message },
      });
      return;
    }

    if (error instanceof ProjectNotFoundError) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: error.message },
      });
      return;
    }

    next(error);
  }
};

export const listLabelsController: RequestHandler = async (req, res, next) => {
  const paramsResult = projectLabelParamsSchema.safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: paramsResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    const labels = await listLabels(
      paramsResult.data.projectId,
      res.locals.user.id,
    );

    res.status(200).json({ data: labels });
  } catch (error: unknown) {
    if (error instanceof ArchivedProjectError) {
      res.status(409).json({
        error: { code: "PROJECT_ARCHIVED", message: error.message },
      });
      return;
    }

    if (error instanceof ProjectNotFoundError) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: error.message },
      });
      return;
    }

    next(error);
  }
};

export const deleteLabelController: RequestHandler = async (req, res, next) => {
  const paramsResult = labelParamsSchema.safeParse(req.params);

  if (!paramsResult.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: paramsResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  try {
    await deleteLabel(
      paramsResult.data.projectId,
      res.locals.user.id,
      paramsResult.data.labelId,
    );

    res.status(204).send();
  } catch (error: unknown) {
    if (error instanceof LabelNotFoundError) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: error.message },
      });
      return;
    }

    if (error instanceof ArchivedProjectError) {
      res.status(409).json({
        error: { code: "PROJECT_ARCHIVED", message: error.message },
      });
      return;
    }

    if (error instanceof ProjectNotFoundError) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: error.message },
      });
      return;
    }

    next(error);
  }
};
