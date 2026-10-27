import { prisma } from "../../infrastructure/database/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type {
  CreateCommentInput,
  ListCommentsQuery,
  UpdateCommentInput,
} from "./comment.schema.js";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentProjectNotFoundError,
  CommentResourceArchivedError,
  CommentTaskNotFoundError,
} from "./comment.errors.js";

const commentResponseSelect = {
  id: true,
  taskId: true,
  authorId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  author: {
    select: {
      id: true,
      profile: {
        select: {
          displayName: true,
        },
      },
    },
  },
} satisfies Prisma.TaskCommentSelect;

type CommentWithAuthor = Prisma.TaskCommentGetPayload<{
  select: typeof commentResponseSelect;
}>;

function toCommentResponse(comment: CommentWithAuthor) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    authorId: comment.authorId,
    author: {
      id: comment.author.id,
      displayName: comment.author.profile?.displayName ?? null,
    },
    body:
      comment.deletedAt === null
        ? comment.body
        : "This comment has been deleted.",
    isDeleted: comment.deletedAt !== null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    deletedAt: comment.deletedAt,
  };
}

async function getAccessibleProject(userId: string, projectId: string) {
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
    throw new CommentProjectNotFoundError();
  }

  return project;
}

async function getTaskInProject(projectId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
    },
    select: {
      id: true,
      archivedAt: true,
    },
  });

  if (!task) {
    throw new CommentTaskNotFoundError();
  }

  return task;
}

function ensureResourcesActive(
  projectArchivedAt: Date | null,
  taskArchivedAt: Date | null,
) {
  if (projectArchivedAt !== null || taskArchivedAt !== null) {
    throw new CommentResourceArchivedError();
  }
}

export async function createComment(
  userId: string,
  projectId: string,
  taskId: string,
  input: CreateCommentInput,
) {
  const project = await getAccessibleProject(userId, projectId);
  const task = await getTaskInProject(project.id, taskId);

  ensureResourcesActive(project.archivedAt, task.archivedAt);

  const comment = await prisma.taskComment.create({
    data: {
      taskId: task.id,
      authorId: userId,
      body: input.body,
    },
    select: commentResponseSelect,
  });

  return toCommentResponse(comment);
}

export async function listComments(
  userId: string,
  projectId: string,
  taskId: string,
  query: ListCommentsQuery,
) {
  const project = await getAccessibleProject(userId, projectId);

  // Archived projects and tasks remain readable.
  await getTaskInProject(project.id, taskId);

  const where = {
    taskId,
  };

  const [comments, totalItems] = await prisma.$transaction([
    prisma.taskComment.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: commentResponseSelect,
    }),
    prisma.taskComment.count({ where }),
  ]);

  return {
    data: comments.map(toCommentResponse),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function updateComment(
  userId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  input: UpdateCommentInput,
) {
  const project = await getAccessibleProject(userId, projectId);
  const task = await getTaskInProject(project.id, taskId);

  ensureResourcesActive(project.archivedAt, task.archivedAt);

  const comment = await prisma.taskComment.findFirst({
    where: {
      id: commentId,
      taskId: task.id,
      deletedAt: null,
    },
    select: {
      id: true,
      authorId: true,
    },
  });

  if (!comment) {
    throw new CommentNotFoundError();
  }

  if (comment.authorId !== userId) {
    throw new CommentForbiddenError();
  }

  const updatedComment = await prisma.taskComment.update({
    where: { id: comment.id },
    data: { body: input.body },
    select: commentResponseSelect,
  });

  return toCommentResponse(updatedComment);
}

export async function deleteComment(
  userId: string,
  projectId: string,
  taskId: string,
  commentId: string,
) {
  const project = await getAccessibleProject(userId, projectId);
  const task = await getTaskInProject(project.id, taskId);

  ensureResourcesActive(project.archivedAt, task.archivedAt);

  const comment = await prisma.taskComment.findFirst({
    where: {
      id: commentId,
      taskId: task.id,
      deletedAt: null,
    },
    select: {
      id: true,
      authorId: true,
    },
  });

  if (!comment) {
    throw new CommentNotFoundError();
  }

  if (comment.authorId !== userId) {
    throw new CommentForbiddenError();
  }

  const deletedComment = await prisma.taskComment.update({
    where: { id: comment.id },
    data: { deletedAt: new Date() },
    select: commentResponseSelect,
  });

  return toCommentResponse(deletedComment);
}
