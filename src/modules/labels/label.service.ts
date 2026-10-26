import { prisma } from "../../infrastructure/database/prisma.js";
import {
  ArchivedProjectError,
  DuplicateLabelNameError,
  LabelNotFoundError,
  ProjectNotFoundError,
} from "./label.errors.js";

export async function createLabel(
  projectId: string,
  ownerId: string,
  name: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!project) {
    const archivedProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId,
        archivedAt: { not: null },
      },
      select: { id: true },
    });

    if (archivedProject) {
      throw new ArchivedProjectError();
    }

    throw new ProjectNotFoundError();
  }

  try {
    return await prisma.label.create({
      data: {
        projectId,
        name,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      throw new DuplicateLabelNameError();
    }

    throw error;
  }
}

export async function listLabels(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!project) {
    const archivedProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId,
        archivedAt: { not: null },
      },
      select: { id: true },
    });

    if (archivedProject) {
      throw new ArchivedProjectError();
    }

    throw new ProjectNotFoundError();
  }

  return prisma.label.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      projectId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function deleteLabel(
  projectId: string,
  ownerId: string,
  labelId: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!project) {
    const archivedProject = await prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId,
        archivedAt: { not: null },
      },
      select: { id: true },
    });

    if (archivedProject) {
      throw new ArchivedProjectError();
    }

    throw new ProjectNotFoundError();
  }

  const label = await prisma.label.findFirst({
    where: { id: labelId, projectId },
    select: { id: true },
  });

  if (!label) {
    throw new LabelNotFoundError();
  }

  await prisma.label.delete({
    where: {
      projectId_id: { projectId, id: labelId },
    },
  });
}
