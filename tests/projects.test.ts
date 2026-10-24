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

    // Projects must be removed before their owners because the
    // foreign key deliberately prevents deleting an owner first.
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
  const email = `projects-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Projects Test",
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

  return {
    userId: user.id,
    accessCookie: accessCookie!,
  };
}

describe("POST /api/v1/projects", () => {
  it("creates a project owned by the authenticated user", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", user.accessCookie)
      .send({
        name: "My First Project",
        description: "A project for testing TaskFlow.",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      name: "My First Project",
      description: "A project for testing TaskFlow.",
      archivedAt: null,
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data).not.toHaveProperty("ownerId");

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(project.ownerId).toBe(user.userId);
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .send({ name: "Unauthorized Project" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects invalid project input", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", user.accessCookie)
      .send({
        name: "   ",
        description: "A project with an invalid name.",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an attempt to supply ownerId in the request body", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", user.accessCookie)
      .send({
        name: "Ownership Test",
        ownerId: randomUUID(),
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    const project = await prisma.project.findFirst({
      where: { name: "Ownership Test", ownerId: user.userId },
    });

    expect(project).toBeNull();
  });
});
