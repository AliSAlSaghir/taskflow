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

describe("GET /api/v1/projects", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app).get("/api/v1/projects");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns only projects owned by the authenticated user", async () => {
    const owner = await createLoggedInUser();
    const anotherUser = await createLoggedInUser();

    await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Owner Project",
      },
    });

    await prisma.project.create({
      data: {
        ownerId: anotherUser.userId,
        name: "Another User Project",
      },
    });

    const response = await request(app)
      .get("/api/v1/projects")
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("Owner Project");
    expect(response.body.data[0]).not.toHaveProperty("ownerId");
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("paginates results without duplicating projects across pages", async () => {
    const user = await createLoggedInUser();

    for (const name of ["Project A", "Project B", "Project C"]) {
      await prisma.project.create({
        data: {
          ownerId: user.userId,
          name,
        },
      });
    }

    const firstPage = await request(app)
      .get("/api/v1/projects")
      .query({ page: 1, limit: 2 })
      .set("Cookie", user.accessCookie);

    const secondPage = await request(app)
      .get("/api/v1/projects")
      .query({ page: 2, limit: 2 })
      .set("Cookie", user.accessCookie);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
      totalItems: 3,
      totalPages: 2,
    });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.pagination.totalPages).toBe(2);

    const firstIds = firstPage.body.data.map(
      (project: { id: string }) => project.id,
    );
    const secondIds = secondPage.body.data.map(
      (project: { id: string }) => project.id,
    );

    expect(firstIds).not.toContain(secondIds[0]);
    expect([...firstIds, ...secondIds]).toHaveLength(3);
  });

  it("returns active projects by default and archived projects when requested", async () => {
    const user = await createLoggedInUser();

    await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Active Project",
      },
    });

    await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Archived Project",
        archivedAt: new Date(),
      },
    });

    const activeResponse = await request(app)
      .get("/api/v1/projects")
      .set("Cookie", user.accessCookie);

    expect(activeResponse.status).toBe(200);
    expect(
      activeResponse.body.data.map((project: { name: string }) => project.name),
    ).toEqual(["Active Project"]);

    const archivedResponse = await request(app)
      .get("/api/v1/projects")
      .query({ archived: true })
      .set("Cookie", user.accessCookie);

    expect(archivedResponse.status).toBe(200);
    expect(
      archivedResponse.body.data.map(
        (project: { name: string }) => project.name,
      ),
    ).toEqual(["Archived Project"]);
  });

  it("rejects invalid pagination and archive query parameters", async () => {
    const user = await createLoggedInUser();

    for (const query of [
      { page: "0" },
      { page: "abc" },
      { limit: "101" },
      { archived: "yes" },
    ]) {
      const response = await request(app)
        .get("/api/v1/projects")
        .query(query)
        .set("Cookie", user.accessCookie);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns an empty list when the user has no projects", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .get("/api/v1/projects")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 0,
      totalPages: 0,
    });
  });
});

describe("GET /api/v1/projects/:projectId", () => {
  it("returns a project owned by the authenticated user", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Project Details Test",
        description: "Testing single-project retrieval.",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: project.id,
      name: "Project Details Test",
      description: "Testing single-project retrieval.",
      archivedAt: null,
    });
    expect(response.body.data).not.toHaveProperty("ownerId");
  });

  it("returns 404 when the project belongs to another user", async () => {
    const owner = await createLoggedInUser();
    const anotherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Private Project",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set("Cookie", anotherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.message).toBe(
      "The requested resource was not found.",
    );
  });

  it("returns 404 when the project does not exist", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .get(`/api/v1/projects/${randomUUID()}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed project UUID", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .get("/api/v1/projects/not-a-uuid")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/v1/projects/:projectId", () => {
  it("updates a project's name without changing its description", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Original Name",
        description: "Keep this description.",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Updated Name" });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: project.id,
      name: "Updated Name",
      description: "Keep this description.",
    });
    expect(response.body.data).not.toHaveProperty("ownerId");
  });

  it("updates or clears a project's description", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Description Test",
        description: "Original description.",
      },
    });

    const updateResponse = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({ description: "Updated description." });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.description).toBe("Updated description.");

    const clearResponse = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({ description: null });

    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body.data.description).toBeNull();
  });

  it("rejects an empty body and unsupported fields", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Validation Test",
      },
    });

    const emptyResponse = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({});

    expect(emptyResponse.status).toBe(400);
    expect(emptyResponse.body.error.code).toBe("VALIDATION_ERROR");

    const unsupportedResponse = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({ ownerId: randomUUID() });

    expect(unsupportedResponse.status).toBe(400);
    expect(unsupportedResponse.body.error.code).toBe("VALIDATION_ERROR");

    const unchangedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });

    expect(unchangedProject.ownerId).toBe(user.userId);
    expect(unchangedProject.name).toBe("Validation Test");
  });

  it("rejects invalid field values", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Invalid Input Test",
      },
    });

    for (const body of [
      { name: "   " },
      { name: "x".repeat(121) },
      { description: "x".repeat(2001) },
    ]) {
      const response = await request(app)
        .patch(`/api/v1/projects/${project.id}`)
        .set("Cookie", user.accessCookie)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns 404 when the project belongs to another user", async () => {
    const owner = await createLoggedInUser();
    const anotherUser = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Private Project",
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", anotherUser.accessCookie)
      .send({ name: "Unauthorized Change" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });

    expect(unchangedProject.name).toBe("Private Project");
  });

  it("returns 404 when the project does not exist", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch(`/api/v1/projects/${randomUUID()}`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Missing Project" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed project UUID", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/projects/not-a-uuid")
      .set("Cookie", user.accessCookie)
      .send({ name: "Updated Name" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not allow archived projects to be updated", async () => {
    const user = await createLoggedInUser();

    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Archived Project",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .patch(`/api/v1/projects/${project.id}`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Should Not Change" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const unchangedProject = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
    });

    expect(unchangedProject.name).toBe("Archived Project");
  });

  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .patch(`/api/v1/projects/${randomUUID()}`)
      .send({ name: "Unauthorized Project" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("DELETE /api/v1/projects/:projectId", () => {
  it("archives a project without deleting it", async () => {
    const { accessCookie: cookie, userId } = await createLoggedInUser();
    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .send({ name: "Project to archive" });

    const projectId = createResponse.body.data.id as string;

    const response = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(projectId);
    expect(response.body.data.archivedAt).not.toBeNull();

    const storedProject = await prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    expect(storedProject).not.toBeNull();
    expect(storedProject?.archivedAt).not.toBeNull();
  });

  it("returns 200 when archiving an already archived project", async () => {
    const { accessCookie: cookie } = await createLoggedInUser();
    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .send({ name: "Already archived" });

    const projectId = createResponse.body.data.id as string;

    const firstResponse = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", cookie);

    const firstArchivedAt = firstResponse.body.data.archivedAt;

    const secondResponse = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", cookie);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.data.archivedAt).toBe(firstArchivedAt);
  });

  it("does not let another user archive the project", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", owner.accessCookie)
      .send({ name: "Owner's project" });

    const projectId = createResponse.body.data.id as string;

    const response = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);

    const storedProject = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(storedProject?.archivedAt).toBeNull();
  });

  it("returns 400 for an invalid project ID", async () => {
    const { accessCookie: cookie } = await createLoggedInUser();

    const response = await request(app)
      .delete("/api/v1/projects/not-a-uuid")
      .set("Cookie", cookie);

    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(app).delete(
      "/api/v1/projects/00000000-0000-4000-8000-000000000001",
    );

    expect(response.status).toBe(401);
  });
});

describe("POST /api/v1/projects/:projectId/unarchive", () => {
  it("restores an archived project", async () => {
    const { accessCookie: cookie } = await createLoggedInUser();
    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .send({ name: "Project to restore" });

    const projectId = createResponse.body.data.id as string;

    await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", cookie);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/unarchive`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(projectId);
    expect(response.body.data.archivedAt).toBeNull();
  });

  it("returns 200 when restoring a project that is already active", async () => {
    const { accessCookie: cookie } = await createLoggedInUser();
    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", cookie)
      .send({ name: "Already active" });

    const projectId = createResponse.body.data.id as string;

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/unarchive`)
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.archivedAt).toBeNull();
  });

  it("does not let another user restore the project", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();

    const createResponse = await request(app)
      .post("/api/v1/projects")
      .set("Cookie", owner.accessCookie)
      .send({ name: "Private archived project" });

    const projectId = createResponse.body.data.id as string;

    await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set("Cookie", owner.accessCookie);

    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/unarchive`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);

    const storedProject = await prisma.project.findUnique({
      where: { id: projectId },
    });

    expect(storedProject?.archivedAt).not.toBeNull();
  });

  it("returns 400 for an invalid project ID", async () => {
    const { accessCookie: cookie } = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects/not-a-uuid/unarchive")
      .set("Cookie", cookie);

    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(app).post(
      "/api/v1/projects/00000000-0000-4000-8000-000000000001/unarchive",
    );

    expect(response.status).toBe(401);
  });
});
