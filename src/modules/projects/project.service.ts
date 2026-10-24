import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  CreateProjectInput,
  ListProjectsQuery,
  UpdateProjectInput,
} from "./project.schema.js";

export async function createProject(
  ownerId: string,
  input: CreateProjectInput,
) {
  return prisma.project.create({
    data: {
      ownerId,
      name: input.name,
      description: input.description ?? null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function listProjects(ownerId: string, query: ListProjectsQuery) {
  const where = {
    ownerId,
    archivedAt: query.archived ? { not: null } : null,
  };

  const [projects, totalItems] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        name: true,
        description: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.project.count({ where }),
  ]);

  return {
    data: projects,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function getProject(ownerId: string, projectId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateProject(
  ownerId: string,
  projectId: string,
  input: UpdateProjectInput,
) {
  const data = {
    ...(input.name !== undefined && {
      name: input.name,
    }),
    ...(input.description !== undefined && {
      description: input.description,
    }),
  };

  const result = await prisma.project.updateMany({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    data,
  });

  if (result.count === 0) {
    return null;
  }

  return prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
