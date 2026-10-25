import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";

const emailsToClean: string[] = [];

afterEach(async () => {
  for (const email of emailsToClean) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) continue;

    // Remove tasks before their projects and memberships.
    await prisma.task.deleteMany({
      where: { project: { ownerId: user.id } },
    });

    await prisma.projectMembership.deleteMany({
      where: {
        OR: [{ project: { ownerId: user.id } }, { userId: user.id }],
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
