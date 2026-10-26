import { prisma } from "../../infrastructure/database/prisma.js";
import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
  UpdateTaskStatusInput,
} from "./task.schema.js";
import {
  LabelNotFoundError,
  ProjectArchivedError,
  ProjectNotFoundError,
  TaskAssigneeNotEligibleError,
  TaskLabelNotFoundError,
  TaskNotFoundError,
  TaskUpdateForbiddenError,
} from "./task.errors.js";
import { Prisma } from "../../generated/prisma/client.js";

const taskResponseSelect = {
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
  labels: {
    select: {
      label: {
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.TaskSelect;

type TaskWithLabels = Prisma.TaskGetPayload<{
  select: typeof taskResponseSelect;
}>;

function toTaskResponse(task: TaskWithLabels) {
  const { labels, ...taskFields } = task;

  return {
    ...taskFields,
    labels: labels.map(({ label }) => label),
  };
}

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

  const task = await prisma.task.create({
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
    select: taskResponseSelect,
  });

  return toTaskResponse(task);
}

export async function listTasks(
  userId: string,
  projectId: string,
  query: ListTasksQuery,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
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
    select: { id: true },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  const where = {
    projectId: project.id,
    archivedAt: null,
    ...(query.status !== undefined && { status: query.status }),
    ...(query.priority !== undefined && { priority: query.priority }),
    ...(query.assigneeId !== undefined && {
      assigneeId: query.assigneeId,
    }),
  };

  const [tasks, totalItems] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: taskResponseSelect,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    data: tasks.map(toTaskResponse),
    pagination: {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    },
  };
}

export async function updateTask(
  userId: string,
  projectId: string,
  taskId: string,
  input: UpdateTaskInput | UpdateTaskStatusInput,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
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
    },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId: project.id,
      archivedAt: null,
    },
    select: {
      id: true,
      assigneeId: true,
    },
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  const isOwner = project.ownerId === userId;

  if (!isOwner) {
    if (
      task.assigneeId !== userId ||
      !("status" in input) ||
      Object.keys(input).length !== 1
    ) {
      throw new TaskUpdateForbiddenError();
    }
  }

  if (isOwner && "assigneeId" in input && input.assigneeId) {
    const membership = await prisma.projectMembership.findFirst({
      where: {
        projectId: project.id,
        userId: input.assigneeId,
        user: { status: "ACTIVE" },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new TaskAssigneeNotEligibleError();
    }
  }

  const data: Prisma.TaskUncheckedUpdateInput = {};

  if ("title" in input && input.title !== undefined) {
    data.title = input.title;
  }

  if ("description" in input && input.description !== undefined) {
    data.description = input.description;
  }

  if ("status" in input && input.status !== undefined) {
    data.status = input.status;
  }

  if ("priority" in input && input.priority !== undefined) {
    data.priority = input.priority;
  }

  if ("assigneeId" in input && input.assigneeId !== undefined) {
    data.assigneeId = input.assigneeId;
  }

  if ("dueDate" in input && input.dueDate !== undefined) {
    data.dueDate = input.dueDate
      ? new Date(`${input.dueDate}T00:00:00.000Z`)
      : null;
  }

  const updatedTask = await prisma.task.update({
    where: { id: task.id },
    data,
    select: taskResponseSelect,
  });

  return toTaskResponse(updatedTask);
}

export async function archiveTask(
  ownerId: string,
  projectId: string,
  taskId: string,
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
    throw new ProjectNotFoundError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId: project.id,
    },
    select: taskResponseSelect,
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  if (task.archivedAt !== null) {
    return toTaskResponse(task);
  }

  await prisma.task.updateMany({
    where: {
      id: task.id,
      projectId: project.id,
      archivedAt: null,
    },
    data: { archivedAt: new Date() },
  });

  const archivedTask = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    select: taskResponseSelect,
  });

  return toTaskResponse(archivedTask);
}

export async function restoreTask(
  ownerId: string,
  projectId: string,
  taskId: string,
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
    throw new ProjectNotFoundError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId: project.id,
    },
    select: taskResponseSelect,
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  if (task.archivedAt === null) {
    return toTaskResponse(task);
  }

  await prisma.task.updateMany({
    where: {
      id: task.id,
      projectId: project.id,
      archivedAt: { not: null },
    },
    data: { archivedAt: null },
  });

  const restoredTask = await prisma.task.findUniqueOrThrow({
    where: { id: task.id },
    select: taskResponseSelect,
  });

  return toTaskResponse(restoredTask);
}

export async function assignLabelToTask(
  ownerId: string,
  projectId: string,
  taskId: string,
  labelId: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: {
      id: true,
      archivedAt: true,
    },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  const label = await prisma.label.findFirst({
    where: {
      id: labelId,
      projectId,
    },
    select: { id: true },
  });

  if (!label) {
    throw new LabelNotFoundError();
  }

  // A repeated assignment should succeed without creating a duplicate.
  return prisma.taskLabel.upsert({
    where: {
      taskId_labelId: {
        taskId,
        labelId,
      },
    },
    update: {},
    create: {
      projectId,
      taskId,
      labelId,
    },
  });
}

export async function removeLabelFromTask(
  ownerId: string,
  projectId: string,
  taskId: string,
  labelId: string,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ownerId,
    },
    select: {
      id: true,
      archivedAt: true,
    },
  });

  if (!project) {
    throw new ProjectNotFoundError();
  }

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      archivedAt: null,
    },
    select: { id: true },
  });

  if (!task) {
    throw new TaskNotFoundError();
  }

  const label = await prisma.label.findFirst({
    where: {
      id: labelId,
      projectId,
    },
    select: { id: true },
  });

  if (!label) {
    throw new LabelNotFoundError();
  }

  const association = await prisma.taskLabel.findUnique({
    where: {
      taskId_labelId: {
        taskId,
        labelId,
      },
    },
    select: {
      taskId: true,
      labelId: true,
    },
  });

  if (!association) {
    throw new TaskLabelNotFoundError();
  }

  return prisma.taskLabel.delete({
    where: {
      taskId_labelId: {
        taskId,
        labelId,
      },
    },
  });
}
