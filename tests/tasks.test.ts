import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import {
  updateTaskSchema,
  updateTaskStatusSchema,
} from "../src/modules/tasks/task.schema.js";

describe("Task update schemas", () => {
  describe("updateTaskSchema", () => {
    it("accepts a partial owner update", () => {
      expect(
        updateTaskSchema.safeParse({ title: "Updated title" }).success,
      ).toBe(true);
    });

    it("accepts null for nullable fields", () => {
      expect(
        updateTaskSchema.safeParse({
          description: null,
          assigneeId: null,
          dueDate: null,
        }).success,
      ).toBe(true);
    });

    it("rejects an empty update", () => {
      expect(updateTaskSchema.safeParse({}).success).toBe(false);
    });

    it("rejects unknown fields", () => {
      expect(
        updateTaskSchema.safeParse({ unexpectedField: "value" }).success,
      ).toBe(false);
    });
  });

  describe("updateTaskStatusSchema", () => {
    it("accepts a valid status update", () => {
      expect(
        updateTaskStatusSchema.safeParse({ status: "IN_PROGRESS" }).success,
      ).toBe(true);
    });

    it("rejects a request without status", () => {
      expect(updateTaskStatusSchema.safeParse({}).success).toBe(false);
    });

    it("rejects additional fields", () => {
      expect(
        updateTaskStatusSchema.safeParse({
          status: "COMPLETED",
          title: "Unauthorized title change",
        }).success,
      ).toBe(false);
    });
  });
});

const emailsToClean: string[] = [];

afterEach(async () => {
  for (const email of emailsToClean) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) continue;

    await prisma.taskLabel.deleteMany({
      where: {
        task: {
          project: {
            ownerId: user.id,
          },
        },
      },
    });

    await prisma.task.deleteMany({
      where: {
        project: {
          ownerId: user.id,
        },
      },
    });

    await prisma.projectMembership.deleteMany({
      where: {
        OR: [{ project: { ownerId: user.id } }, { userId: user.id }],
      },
    });

    await prisma.label.deleteMany({
      where: {
        project: {
          ownerId: user.id,
        },
      },
    });

    await prisma.project.deleteMany({
      where: { ownerId: user.id },
    });

    const sessions = await prisma.authSession.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const sessionIds = sessions.map((session) => session.id);

    await prisma.refreshToken.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    await prisma.authSession.deleteMany({
      where: { userId: user.id },
    });
    await prisma.profile.deleteMany({
      where: { userId: user.id },
    });
    await prisma.user.delete({
      where: { id: user.id },
    });
  }

  emailsToClean.length = 0;
});

function getCookiePair(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) return undefined;

  return headers
    .find(
      (header): header is string =>
        typeof header === "string" && header.startsWith(`${name}=`),
    )
    ?.split(";")[0];
}

async function createLoggedInUser() {
  const email = `tasks-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";
  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Tasks Test",
  });
  expect(registration.status).toBe(201);

  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password });
  expect(login.status).toBe(200);

  const setCookieHeader = login.headers["set-cookie"];
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : undefined;

  const accessCookie = getCookiePair(headers, "access_token");
  expect(accessCookie).toBeDefined();

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { userId: user.id, accessCookie: accessCookie! };
}

describe("POST /api/v1/projects/:projectId/tasks", () => {
  it("allows the project owner to create a task with default values", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Creation Test Project",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({ title: "Prepare project documentation" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      projectId: project.id,
      title: "Prepare project documentation",
      description: null,
      status: "PENDING",
      priority: "MEDIUM",
      assigneeId: null,
      dueDate: null,
      archivedAt: null,
    });
    expect(response.body.data.id).toEqual(expect.any(String));

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(task.projectId).toBe(project.id);
    expect(response.body.data.labels).toEqual([]);
    expect(task.title).toBe("Prepare project documentation");
  });

  it("rejects an unauthenticated request", async () => {
    const projectOwner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: projectOwner.userId,
        name: "Unauthenticated Task Test",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .send({ title: "Should not be created" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects invalid task input", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Invalid Task Test",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({
        title: "   ",
        priority: "URGENT",
        unexpectedField: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const taskCount = await prisma.task.count({
      where: { projectId: project.id },
    });

    expect(taskCount).toBe(0);
  });

  it("does not allow a non-owner to create a task", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Project Ownership Test",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", otherUser.accessCookie)
      .send({ title: "Unauthorized task" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const taskCount = await prisma.task.count({
      where: { projectId: project.id },
    });

    expect(taskCount).toBe(0);
  });

  it("does not allow task creation in an archived project", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Project Test",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({ title: "Task in archived project" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const taskCount = await prisma.task.count({
      where: { projectId: project.id },
    });

    expect(taskCount).toBe(0);
  });

  it("allows the owner to assign a task to an active project member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Assignment Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({
        title: "Review the requirements",
        assigneeId: member.userId,
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      projectId: project.id,
      title: "Review the requirements",
      assigneeId: member.userId,
      status: "PENDING",
      priority: "MEDIUM",
    });

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(task.assigneeId).toBe(member.userId);
  });

  it("rejects assigning a task to a non-member", async () => {
    const owner = await createLoggedInUser();
    const nonMember = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Non-Member Assignment Test",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({
        title: "Task with invalid assignee",
        assigneeId: nonMember.userId,
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const taskCount = await prisma.task.count({
      where: { projectId: project.id },
    });

    expect(taskCount).toBe(0);
  });

  it("rejects assigning a task to a disabled project member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Disabled Assignee Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.user.update({
      where: { id: member.userId },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie)
      .send({
        title: "Task for disabled member",
        assigneeId: member.userId,
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const taskCount = await prisma.task.count({
      where: { projectId: project.id },
    });

    expect(taskCount).toBe(0);
  });
});

describe("GET /api/v1/projects/:projectId/tasks", () => {
  it("allows the project owner to list tasks", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "List Tasks Test Project",
      },
    });

    await prisma.task.createMany({
      data: [
        { projectId: project.id, title: "First task" },
        { projectId: project.id, title: "Second task" },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.map((task: { title: string }) => task.title),
    ).toEqual(expect.arrayContaining(["First task", "Second task"]));
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 2,
      totalPages: 1,
    });
  });

  it("includes assigned labels in task responses", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Labels Response Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task with a label",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    await prisma.taskLabel.create({
      data: {
        projectId: project.id,
        taskId: task.id,
        labelId: label.id,
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].labels).toEqual([
      expect.objectContaining({
        id: label.id,
        name: "Bug",
      }),
    ]);
  });

  it("allows an active project member to list tasks", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Member Task Listing Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Assigned to another member",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Assigned to another member");
  });

  it("rejects a user who is not a project member", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Non-Member Task Listing Test",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
  it("excludes archived tasks by default", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Task Listing Test",
      },
    });

    await prisma.task.createMany({
      data: [
        { projectId: project.id, title: "Active task" },
        {
          projectId: project.id,
          title: "Archived task",
          archivedAt: new Date(),
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Active task");
    expect(response.body.pagination.totalItems).toBe(1);
  });
  it("filters tasks by status and priority", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Filtering Test",
      },
    });

    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          title: "High priority in progress",
          status: "IN_PROGRESS",
          priority: "HIGH",
        },
        {
          projectId: project.id,
          title: "Pending high priority",
          status: "PENDING",
          priority: "HIGH",
        },
        {
          projectId: project.id,
          title: "In progress medium priority",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ status: "IN_PROGRESS", priority: "HIGH" })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("High priority in progress");
    expect(response.body.pagination.totalItems).toBe(1);
  });
  it("filters tasks by assignee", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Assignee Filtering Test",
      },
    });

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          title: "Assigned task",
          assigneeId: member.userId,
        },
        {
          projectId: project.id,
          title: "Unassigned task",
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ assigneeId: member.userId })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Assigned task");
    expect(response.body.data[0].assigneeId).toBe(member.userId);
  });
  it("paginates the task list", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Pagination Test",
      },
    });

    await prisma.task.createMany({
      data: [
        { projectId: project.id, title: "Task A" },
        { projectId: project.id, title: "Task B" },
        { projectId: project.id, title: "Task C" },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ page: 2, limit: 2 })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toMatchObject({
      page: 2,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
    });
  });
  it("rejects invalid task filters", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Invalid Task Filter Test",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ status: "INVALID" })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid pagination parameters", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Invalid Task Pagination Test",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ page: 0, limit: 101 })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("does not list tasks in an archived project", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Task Project Listing Test",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("searches task titles case-insensitively", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Search Test",
      },
    });

    await prisma.task.createMany({
      data: [
        { projectId: project.id, title: "Implement Login" },
        { projectId: project.id, title: "Fix LOGIN validation" },
        { projectId: project.id, title: "Update documentation" },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ search: "login" })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.map((task: { title: string }) => task.title),
    ).toEqual(
      expect.arrayContaining(["Implement Login", "Fix LOGIN validation"]),
    );
    expect(response.body.pagination.totalItems).toBe(2);
  });

  it("combines title search with existing filters", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Combined Task Search Test",
      },
    });

    await prisma.task.createMany({
      data: [
        {
          projectId: project.id,
          title: "Implement login",
          status: "IN_PROGRESS",
          priority: "HIGH",
        },
        {
          projectId: project.id,
          title: "Fix login",
          status: "PENDING",
          priority: "HIGH",
        },
        {
          projectId: project.id,
          title: "Implement dashboard",
          status: "IN_PROGRESS",
          priority: "HIGH",
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({
        search: "login",
        status: "IN_PROGRESS",
        priority: "HIGH",
      })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe("Implement login");
    expect(response.body.pagination.totalItems).toBe(1);
  });

  it("rejects an empty task search", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Empty Task Search Test",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ search: "   " })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("filters tasks by label", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Label Filter Test",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Backend",
      },
    });

    const matchingTask = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Implement authentication",
      },
    });

    await prisma.taskLabel.create({
      data: {
        projectId: project.id,
        taskId: matchingTask.id,
        labelId: label.id,
      },
    });

    await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Update documentation",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ labelId: label.id })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].id).toBe(matchingTask.id);
    expect(response.body.pagination.totalItems).toBe(1);
  });

  it("rejects an invalid label ID filter", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Invalid Label Filter Test",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks`)
      .query({ labelId: "not-a-uuid" })
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/v1/projects/:projectId/tasks/:taskId", () => {
  it("allows the project owner to update task details", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Update Test Project",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Original title",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie)
      .send({
        title: "Updated title",
        priority: "HIGH",
        description: "Updated description",
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: task.id,
      projectId: project.id,
      title: "Updated title",
      priority: "HIGH",
      description: "Updated description",
      status: "PENDING",
    });

    const updatedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(updatedTask.title).toBe("Updated title");
    expect(updatedTask.priority).toBe("HIGH");
    expect(updatedTask.description).toBe("Updated description");
  });

  it("allows the owner to clear nullable task fields", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Clear Task Fields Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task with optional fields",
        description: "Remove this description",
        assigneeId: member.userId,
        dueDate: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie)
      .send({
        description: null,
        assigneeId: null,
        dueDate: null,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: task.id,
      description: null,
      assigneeId: null,
      dueDate: null,
    });

    const updatedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(updatedTask.description).toBeNull();
    expect(updatedTask.assigneeId).toBeNull();
    expect(updatedTask.dueDate).toBeNull();
  });
  it("allows an assigned member to update task status", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Member Status Update Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Assigned task",
        assigneeId: member.userId,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", member.accessCookie)
      .send({ status: "IN_PROGRESS" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("IN_PROGRESS");

    const updatedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(updatedTask.status).toBe("IN_PROGRESS");
  });

  it("forbids a member from changing task details", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Member Forbidden Update Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Original title",
        assigneeId: member.userId,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", member.accessCookie)
      .send({
        title: "Unauthorized title",
        priority: "HIGH",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.title).toBe("Original title");
    expect(unchangedTask.priority).toBe("MEDIUM");
  });

  it("forbids a member from updating a task assigned to someone else", async () => {
    const owner = await createLoggedInUser();
    const assignedMember = await createLoggedInUser();
    const otherMember = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Wrong Assignee Update Test",
      },
    });

    await prisma.projectMembership.createMany({
      data: [
        { projectId: project.id, userId: assignedMember.userId },
        { projectId: project.id, userId: otherMember.userId },
      ],
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Another member's task",
        assigneeId: assignedMember.userId,
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", otherMember.accessCookie)
      .send({ status: "COMPLETED" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.status).toBe("PENDING");
  });
  it("rejects an invalid task ID", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Invalid Task ID Test",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/not-a-uuid`)
      .set("Cookie", owner.accessCookie)
      .send({ title: "Updated title" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty update body", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Empty Update Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Original title",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns not found for a task that does not exist", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Missing Task Test",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${randomUUID()}`)
      .set("Cookie", owner.accessCookie)
      .send({ title: "Updated title" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not allow updating tasks in an archived project", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Task Update Test",
        archivedAt: new Date(),
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task in archived project",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie)
      .send({ title: "Updated title" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.title).toBe("Task in archived project");
  });
  it("does not allow updating an archived task", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Task Member Update Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        assigneeId: member.userId,
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", member.accessCookie)
      .send({ status: "COMPLETED" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.status).toBe("PENDING");
  });
  it("rejects assigning a task to a disabled project member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Disabled Assignee Update Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.user.update({
      where: { id: member.userId },
      data: { status: "DISABLED" },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task without an assignee",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie)
      .send({ assigneeId: member.userId });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.assigneeId).toBeNull();
  });
});

describe("DELETE /api/v1/projects/:projectId/tasks/:taskId", () => {
  it("allows the owner to archive a task", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Archive Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task to archive",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(task.id);
    expect(response.body.data.archivedAt).not.toBeNull();

    const archivedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(archivedTask.archivedAt).not.toBeNull();
  });

  it("does not allow a non-owner to archive a task", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Archive Permission Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task owned by another user",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.archivedAt).toBeNull();
  });

  it("returns 404 when the task does not exist", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Missing Task Archive Test",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${randomUUID()}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("allows archiving a task that is already archived", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Repeated Archive Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Already archived",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.archivedAt).not.toBeNull();
  });

  it("does not allow archiving a task in an archived project", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Project Task Test",
        archivedAt: new Date(),
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task in archived project",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/tasks/${task.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.archivedAt).toBeNull();
  });

  it("rejects unauthenticated archive requests", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Unauthenticated Archive Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task requiring authentication",
      },
    });

    const response = await request(app).delete(
      `/api/v1/projects/${project.id}/tasks/${task.id}`,
    );

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/projects/:projectId/tasks/:taskId/restore", () => {
  it("allows the owner to restore an archived task and preserves its data", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Restore Test",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        assigneeId: member.userId,
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/restore`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: task.id,
      title: "Archived task",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: member.userId,
      archivedAt: null,
    });

    const restoredTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(restoredTask.archivedAt).toBeNull();
    expect(restoredTask.status).toBe("IN_PROGRESS");
    expect(restoredTask.assigneeId).toBe(member.userId);
  });

  it("does not allow a non-owner to restore a task", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Task Restore Permission Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/restore`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.archivedAt).not.toBeNull();
  });

  it("returns 404 when the task does not exist", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Missing Task Restore Test",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${randomUUID()}/restore`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("allows restoring a task that is already active", async () => {
    const owner = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Idempotent Task Restore Test",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Already active task",
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/restore`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.archivedAt).toBeNull();
  });
});
