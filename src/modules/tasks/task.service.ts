import { prisma } from "../../infrastructure/database/prisma.js";
import type { CreateTaskInput } from "./task.schema.js";
import {
  ProjectNotFoundError,
  TaskAssigneeNotEligibleError,
} from "./task.errors.js";

export async function createTask(
  ownerId: string,
  projectId: string,
  input: CreateTaskInput,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  if (input.assigneeId) {
    const membership = await prisma.projectMembership.findFirst({
      where: {
        projectId: project.id,
        userId: input.assigneeId,
        user: {
          status: "ACTIVE",
        },
      },
      select: {
        id: true,
      },
    });

    if (!membership) {
      throw new TaskAssigneeNotEligibleError();
    }
  }

  return prisma.task.create({
    data: {
      projectId: project.id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate
        ? new Date(`${input.dueDate}T00:00:00.000Z`)
        : null,
    },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      assigneeId: true,
      dueDate: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
