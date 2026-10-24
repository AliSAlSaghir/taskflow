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
