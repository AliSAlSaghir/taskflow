import multer, { MulterError } from "multer";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { projectIdSchema } from "../projects/project.schema.js";
import {
  AttachmentForbiddenError,
  AttachmentNotFoundError,
  AttachmentResourceArchivedError,
  AttachmentStorageError,
  AttachmentValidationError,
} from "./attachment.errors.js";
import {
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  uploadAttachment,
} from "./attachment.service.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

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

function validatePathIds(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  includeAttachmentId = false,
) {
  const projectResult = projectIdSchema.safeParse(req.params.projectId);
  const taskResult = projectIdSchema.safeParse(req.params.taskId);
  const attachmentResult = includeAttachmentId
    ? projectIdSchema.safeParse(req.params.attachmentId)
    : undefined;

  const details = [
    ...(!projectResult.success
      ? [{ field: "projectId", message: "A valid project ID is required." }]
      : []),
    ...(!taskResult.success
      ? [{ field: "taskId", message: "A valid task ID is required." }]
      : []),
    ...(attachmentResult && !attachmentResult.success
      ? [
          {
            field: "attachmentId",
            message: "A valid attachment ID is required.",
          },
        ]
      : []),
  ];

  if (details.length > 0) {
    sendValidationError(res, details);
    return null;
  }

  if (
    !projectResult.success ||
    !taskResult.success ||
    (attachmentResult && !attachmentResult.success)
  ) {
    return null;
  }

  return {
    projectId: projectResult.data,
    taskId: taskResult.data,
    ...(attachmentResult && { attachmentId: attachmentResult.data }),
  };
}

function handleAttachmentError(
  error: unknown,
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
) {
  if (error instanceof AttachmentNotFoundError) {
    sendNotFound(res);
    return;
  }

  if (error instanceof AttachmentForbiddenError) {
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof AttachmentResourceArchivedError) {
    res.status(409).json({
      error: {
        code: "ATTACHMENT_RESOURCE_ARCHIVED",
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof AttachmentValidationError) {
    sendValidationError(res, [{ field: "file", message: error.message }]);
    return;
  }

  if (error instanceof AttachmentStorageError) {
    res.status(502).json({
      error: {
        code: "ATTACHMENT_STORAGE_ERROR",
        message: error.message,
      },
    });
    return;
  }

  next(error);
}

export const listAttachmentsController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids) return;

  try {
    const attachments = await listAttachments(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
    );

    res.status(200).json({ data: attachments });
  } catch (error: unknown) {
    handleAttachmentError(error, res, next);
  }
};

export const uploadAttachmentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res);
  if (!ids) return;

  if (!req.file) {
    sendValidationError(res, [
      { field: "file", message: "A file is required." },
    ]);
    return;
  }

  try {
    const attachment = await uploadAttachment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      req.file,
    );

    res.status(201).json({ data: attachment });
  } catch (error: unknown) {
    handleAttachmentError(error, res, next);
  }
};

function getContentDisposition(filename: string): string {
  const fallback =
    filename.replace(/[^\x20-\x7E]|["\\;]/g, "_").trim() || "attachment";

  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const downloadAttachmentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res, true);
  if (!ids || !("attachmentId" in ids)) return;

  try {
    const result = await downloadAttachment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      ids.attachmentId,
    );

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      getContentDisposition(result.attachment.filename),
    );
    res.setHeader("Content-Length", result.body.length);
    res.status(200).send(result.body);
  } catch (error: unknown) {
    handleAttachmentError(error, res, next);
  }
};

export const deleteAttachmentController: RequestHandler = async (
  req,
  res,
  next,
) => {
  const ids = validatePathIds(req, res, true);
  if (!ids || !("attachmentId" in ids)) return;

  try {
    const result = await deleteAttachment(
      res.locals.user.id,
      ids.projectId,
      ids.taskId,
      ids.attachmentId,
    );

    res.status(200).json({ data: result });
  } catch (error: unknown) {
    handleAttachmentError(error, res, next);
  }
};

export const handleAttachmentUploadError: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: [
            {
              field: "file",
              message: "The file must be no larger than 5 MB.",
            },
          ],
        },
      });
      return;
    }

    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The uploaded file request is invalid.",
      },
    });
    return;
  }

  next(error);
};
