import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  MemberHasAssignedTasksError,
  MemberNotEligibleError,
  MembershipAlreadyExistsError,
  MembershipNotFoundError,
  ProjectNotFoundError,
} from "./membership.errors.js";
import type { ListProjectMembersQuery } from "./project.schema.js";

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

export async function listProjectMembers(
  ownerId: string,
  projectId: string,
  query: ListProjectMembersQuery,
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

  const where = {
    projectId: project.id,
  };

  const [members, totalItems] = await prisma.$transaction([
    prisma.projectMembership.findMany({
      where,
      orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
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
    }),
    prisma.projectMembership.count({ where }),
  ]);

  return {
    data: members,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function removeProjectMember(
  ownerId: string,
  projectId: string,
  membershipId: string,
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

  const membership = await prisma.projectMembership.findFirst({
    where: {
      id: membershipId,
      projectId: project.id,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!membership) {
    throw new MembershipNotFoundError();
  }

  const assignedTasks = await prisma.task.count({
    where: {
      projectId: project.id,
      assigneeId: membership.userId,
    },
  });

  if (assignedTasks > 0) {
    throw new MemberHasAssignedTasksError();
  }

  await prisma.projectMembership.delete({
    where: {
      id: membership.id,
    },
  });
}
