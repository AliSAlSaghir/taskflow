import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  ListAdminUsersQuery,
  ListAdminProjectsQuery,
} from "./admin.schema.js";

export async function listAdminUsers(query: ListAdminUsersQuery) {
  const where = query.search
    ? {
        OR: [
          {
            email: {
              contains: query.search,
              mode: "insensitive" as const,
            },
          },
          {
            profile: {
              is: {
                displayName: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            },
          },
        ],
      }
    : {};

  const [users, totalItems] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            displayName: true,
          },
        },
        _count: {
          select: {
            ownedProjects: true,
            projectMemberships: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: users,
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function getAdminUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      profile: {
        select: {
          displayName: true,
          bio: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          ownedProjects: true,
          projectMemberships: true,
        },
      },
    },
  });
}

export async function listAdminProjects(query: ListAdminProjectsQuery) {
  const where = {
    ...(query.search !== undefined && {
      name: {
        contains: query.search,
        mode: "insensitive" as const,
      },
    }),
    ...(query.archived !== undefined && {
      archivedAt: query.archived ? { not: null } : null,
    }),
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
        owner: {
          select: {
            id: true,
            email: true,
            status: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
        _count: {
          select: {
            memberships: true,
            tasks: true,
          },
        },
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

export async function getAdminProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
      memberships: {
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          joinedAt: true,
          user: {
            select: {
              id: true,
              email: true,
              status: true,
              profile: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      },
      labels: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      },
      tasks: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          assigneeId: true,
          dueDate: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
          assignee: {
            select: {
              user: {
                select: {
                  id: true,
                  email: true,
                  profile: {
                    select: {
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
          labels: {
            select: {
              label: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          comments: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
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
            },
          },
          attachments: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              uploaderId: true,
              filename: true,
              contentType: true,
              size: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    return null;
  }

  return {
    ...project,
    tasks: project.tasks.map((task) => ({
      ...task,
      comments: task.comments.map((comment) => ({
        ...comment,
        body:
          comment.deletedAt === null
            ? comment.body
            : "This comment has been deleted.",
        isDeleted: comment.deletedAt !== null,
      })),
    })),
  };
}
