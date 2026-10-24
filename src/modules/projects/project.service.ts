import { prisma } from "../../infrastructure/database/prisma.js";
import type { CreateProjectInput } from "./project.schema.js";

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
