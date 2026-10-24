import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  MemberNotEligibleError,
  MembershipAlreadyExistsError,
  ProjectNotFoundError,
} from "./membership.errors.js";

export async function addProjectMember(
  ownerId: string,
  projectId: string,
  email: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
      archivedAt: null,
    },
    select: {
      id: true,
      ownerId: true,
    },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: {
      email: normalizedEmail,
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          displayName: true,
        },
      },
    },
  });

  if (!user || user.id === project.ownerId) {
    throw new MemberNotEligibleError();
  }

  try {
    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: user.id,
      },
      select: {
        id: true,
        projectId: true,
        userId: true,
        joinedAt: true,
        user: {
          select: {
            email: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    return membership;
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new MembershipAlreadyExistsError();
    }

    throw error;
  }
}
