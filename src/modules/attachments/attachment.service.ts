import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  deleteObject,
  downloadObject,
  uploadObject,
} from "../../infrastructure/storage.js";
import {
  AttachmentForbiddenError,
  AttachmentNotFoundError,
  AttachmentStorageError,
  AttachmentValidationError,
  AttachmentResourceArchivedError,
} from "./attachment.errors.js";
import { isUtf8 } from "node:buffer";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const attachmentResponseSelect = {
  id: true,
  taskId: true,
  uploaderId: true,
  filename: true,
  contentType: true,
  size: true,
  createdAt: true,
};

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

async function getAccessibleResources(
  userId: string,
  projectId: string,
  taskId: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        {
          memberships: {
            some: {
              userId,
              user: { status: "ACTIVE" },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      ownerId: true,
      archivedAt: true,
    },
  });

  if (!project) {
    throw new AttachmentNotFoundError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId: project.id,
    },
    select: {
      id: true,
      archivedAt: true,
    },
  });

  if (!task) {
    throw new AttachmentNotFoundError();
  }

  return { project, task };
}

function ensureResourcesActive(
  projectArchivedAt: Date | null,
  taskArchivedAt: Date | null,
) {
  if (projectArchivedAt !== null || taskArchivedAt !== null) {
    throw new AttachmentResourceArchivedError();
  }
}

function validateFile(file: UploadedFile) {
  if (file.size <= 0) {
    throw new AttachmentValidationError("The uploaded file is empty.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new AttachmentValidationError(
      "The file must be no larger than 5 MB.",
    );
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.mimetype)) {
    throw new AttachmentValidationError(
      "Unsupported file type. Allowed types are JPEG, PNG, WebP, PDF, and plain text.",
    );
  }

  if (!matchesDeclaredContentType(file.buffer, file.mimetype)) {
    throw new AttachmentValidationError(
      "The file contents do not match the declared file type.",
    );
  }
}

function matchesDeclaredContentType(
  buffer: Buffer,
  contentType: string,
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
      );

    case "image/png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );

    case "application/pdf":
      return buffer.subarray(0, 5).toString("ascii") === "%PDF-";

    case "text/plain":
      return !buffer.includes(0) && isUtf8(buffer);

    default:
      return false;
  }
}

function getSafeFilename(filename: string) {
  const safe = filename
    .replace(/[/\\]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);

  return safe || "attachment";
}

async function runStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new AttachmentStorageError();
  }
}

export async function listAttachments(
  userId: string,
  projectId: string,
  taskId: string,
) {
  const { task } = await getAccessibleResources(userId, projectId, taskId);

  return prisma.attachment.findMany({
    where: { taskId: task.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: attachmentResponseSelect,
  });
}

export async function uploadAttachment(
  userId: string,
  projectId: string,
  taskId: string,
  file: UploadedFile,
) {
  const { project, task } = await getAccessibleResources(
    userId,
    projectId,
    taskId,
  );

  if (project.ownerId !== userId) {
    throw new AttachmentForbiddenError();
  }

  ensureResourcesActive(project.archivedAt, task.archivedAt);
  validateFile(file);

  const storageKey = `attachments/${randomUUID()}`;

  await runStorageOperation(() =>
    uploadObject(storageKey, file.buffer, file.mimetype),
  );

  try {
    return await prisma.attachment.create({
      data: {
        taskId: task.id,
        uploaderId: userId,
        filename: getSafeFilename(file.originalname),
        contentType: file.mimetype,
        size: file.size,
        storageKey,
      },
      select: attachmentResponseSelect,
    });
  } catch (error: unknown) {
    // Best-effort cleanup if storing the metadata fails.
    try {
      await deleteObject(storageKey);
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }
}

export async function downloadAttachment(
  userId: string,
  projectId: string,
  taskId: string,
  attachmentId: string,
) {
  const { task } = await getAccessibleResources(userId, projectId, taskId);

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      taskId: task.id,
    },
  });

  if (!attachment) {
    throw new AttachmentNotFoundError();
  }

  const object = await runStorageOperation(() =>
    downloadObject(attachment.storageKey),
  );

  return {
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    },
    body: object.body,
    contentType: object.contentType ?? attachment.contentType,
  };
}

export async function deleteAttachment(
  userId: string,
  projectId: string,
  taskId: string,
  attachmentId: string,
) {
  const { project, task } = await getAccessibleResources(
    userId,
    projectId,
    taskId,
  );

  if (project.ownerId !== userId) {
    throw new AttachmentForbiddenError();
  }

  ensureResourcesActive(project.archivedAt, task.archivedAt);

  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      taskId: task.id,
    },
    select: {
      id: true,
      storageKey: true,
    },
  });

  if (!attachment) {
    throw new AttachmentNotFoundError();
  }

  await runStorageOperation(() => deleteObject(attachment.storageKey));

  try {
    await prisma.attachment.delete({
      where: { id: attachment.id },
    });
  } catch (error: unknown) {
    // The object is already gone, so preserve the original database error.
    // A future reconciliation process could repair this inconsistency.
    throw error;
  }

  return { id: attachment.id };
}
