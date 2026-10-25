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

    await prisma.task.deleteMany({
      where: {
        OR: [{ project: { ownerId: user.id } }, { assigneeId: user.id }],
      },
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
  const email = `membership-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";
  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Membership Test",
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

  return { userId: user.id, email, accessCookie: accessCookie! };
}

async function createProject(ownerId: string) {
  return prisma.project.create({
    data: {
      ownerId,
      name: "Membership Test Project",
    },
  });
}

describe("POST /api/v1/projects/:projectId/members", () => {
  it("allows the owner to add an active registered user", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: member.email.toUpperCase() });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      projectId: project.id,
      userId: member.userId,
      user: {
        email: member.email,
        profile: { displayName: "Membership Test" },
      },
    });
    expect(response.body.data).not.toHaveProperty("passwordHash");

    const count = await prisma.projectMembership.count({
      where: { projectId: project.id, userId: member.userId },
    });
    expect(count).toBe(1);
  });

  it("returns 409 when the user is already a member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: member.email });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MEMBERSHIP_ALREADY_EXISTS");
  });

  it("does not allow a non-owner to add a member", async () => {
    const owner = await createLoggedInUser();
    const nonOwner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", nonOwner.accessCookie)
      .send({ email: member.email });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not allow adding members to an archived project", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: member.email });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not allow adding the project owner as a member", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: owner.email });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for a nonexistent user", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: `missing-${randomUUID()}@example.com` });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for a disabled user", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.user.update({
      where: { id: member.userId },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: member.email });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid email input", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie)
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid project ID", async () => {
    const owner = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects/not-a-uuid/members")
      .set("Cookie", owner.accessCookie)
      .send({ email: "member@example.com" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/v1/projects/:projectId/members", () => {
  it("lists project members without including the owner", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      userId: member.userId,
      user: {
        email: member.email,
        profile: { displayName: "Membership Test" },
      },
    });
    expect(response.body.data[0].userId).not.toBe(owner.userId);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
    expect(response.body.data[0]).not.toHaveProperty("passwordHash");
  });
  it("returns 404 when a non-owner tries to list project members", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when listing members of an archived project", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for an invalid project ID", async () => {
    const owner = await createLoggedInUser();

    const response = await request(app)
      .get("/api/v1/projects/not-a-uuid/members")
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const response = await request(app).get(
      `/api/v1/projects/${randomUUID()}/members`,
    );

    expect(response.status).toBe(401);
  });
  it("returns an empty list when the project has no members", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 10,
      totalItems: 0,
      totalPages: 0,
    });
  });
  it("paginates the project member list", async () => {
    const owner = await createLoggedInUser();
    const members = await Promise.all([
      createLoggedInUser(),
      createLoggedInUser(),
      createLoggedInUser(),
    ]);
    const project = await createProject(owner.userId);

    for (const member of members) {
      await prisma.projectMembership.create({
        data: {
          projectId: project.id,
          userId: member.userId,
        },
      });
    }

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members?page=2&limit=2`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({
      page: 2,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
    });
  });

  it.each([
    ["page=0", "?page=0"],
    ["negative page", "?page=-1"],
    ["limit=0", "?limit=0"],
    ["limit above maximum", "?limit=101"],
    ["non-numeric page", "?page=abc"],
  ])("returns 400 for %s", async (_description, query) => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/members${query}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/v1/projects/:projectId/members/:membershipId", () => {
  it("allows the owner to remove a project member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(204);
    expect(response.text).toBe("");

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).toBeNull();

    // Removing membership must not delete the user's account.
    const remainingUser = await prisma.user.findUnique({
      where: { id: member.userId },
    });

    expect(remainingUser).not.toBeNull();
  });

  it("returns 404 when a non-owner tries to remove a member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).not.toBeNull();
  });

  it("returns 404 when the project is archived", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).not.toBeNull();
  });

  it("returns 404 when the membership does not exist", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${randomUUID()}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
  });

  it("returns 404 when the membership belongs to another project", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const firstProject = await createProject(owner.userId);
    const secondProject = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: firstProject.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${secondProject.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).not.toBeNull();
  });

  it("returns 400 when either ID is invalid", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const invalidProjectIdResponse = await request(app)
      .delete(`/api/v1/projects/not-a-uuid/members/${randomUUID()}`)
      .set("Cookie", owner.accessCookie);

    const invalidMembershipIdResponse = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/not-a-uuid`)
      .set("Cookie", owner.accessCookie);

    expect(invalidProjectIdResponse.status).toBe(400);
    expect(invalidMembershipIdResponse.status).toBe(400);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const response = await request(app).delete(
      `/api/v1/projects/${randomUUID()}/members/${randomUUID()}`,
    );

    expect(response.status).toBe(401);
  });

  it("returns 409 when the member has active assigned tasks", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task assigned to member",
        assigneeId: member.userId,
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MEMBER_HAS_ASSIGNED_TASKS");

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).not.toBeNull();

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.assigneeId).toBe(member.userId);
  });

  it("allows removal after the member's task is unassigned", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task to unassign",
        assigneeId: member.userId,
      },
    });

    await prisma.task.update({
      where: { id: task.id },
      data: { assigneeId: null },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(204);

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });

    expect(remainingMembership).toBeNull();

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });

    expect(unchangedTask.assigneeId).toBeNull();
  });
  it("returns 409 when the member has archived assigned tasks", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const membership = await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task assigned to member",
        assigneeId: member.userId,
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/members/${membership.id}`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MEMBER_HAS_ASSIGNED_TASKS");

    const remainingMembership = await prisma.projectMembership.findUnique({
      where: { id: membership.id },
    });
    expect(remainingMembership).not.toBeNull();

    const unchangedTask = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(unchangedTask.assigneeId).toBe(member.userId);
  });
});
