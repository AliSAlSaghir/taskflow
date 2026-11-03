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

    const ownedProjects = await prisma.project.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    });

    const projectIds = ownedProjects.map((project) => project.id);

    if (projectIds.length > 0) {
      const tasks = await prisma.task.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true },
      });

      const taskIds = tasks.map((task) => task.id);

      await prisma.attachment.deleteMany({
        where: { taskId: { in: taskIds } },
      });

      await prisma.taskComment.deleteMany({
        where: { taskId: { in: taskIds } },
      });

      await prisma.taskLabel.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await prisma.task.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await prisma.label.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }

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

async function createLoggedInUser(prefix: string, admin = false) {
  const email = `${prefix}-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Admin Test",
  });

  expect(registration.status).toBe(201);

  if (admin) {
    await prisma.user.update({
      where: { email },
      data: { role: "ADMIN" },
    });
  }

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

  const csrfResponse = await request(app)
    .get("/api/v1/auth/csrf-token")
    .set("Cookie", accessCookie!);

  expect(csrfResponse.status).toBe(200);

  const csrfToken = csrfResponse.body.data.csrfToken as string;

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  const refreshCookie = getCookiePair(headers, "refresh_token");

  expect(refreshCookie).toBeDefined();

  return {
    email,
    userId: user.id,
    accessCookie: accessCookie!,
    rawRefreshToken: refreshCookie!.slice("refresh_token=".length),
    csrfToken,
  };
}

describe("Admin user inspection", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app).get("/api/v1/admin/users");

    expect(response.status).toBe(401);
  });

  it("rejects authenticated non-admin users", async () => {
    const user = await createLoggedInUser("admin-forbidden");

    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows administrators to list users without exposing sensitive data", async () => {
    const admin = await createLoggedInUser("admin-authorized", true);

    const response = await request(app)
      .get("/api/v1/admin/users")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeInstanceOf(Array);
    expect(response.body.pagination).toBeDefined();

    const serializedResponse = JSON.stringify(response.body);

    expect(serializedResponse).not.toContain("passwordHash");
    expect(serializedResponse).not.toContain("password_hash");
    expect(serializedResponse).not.toContain("refreshToken");
    expect(serializedResponse).not.toContain("accessToken");
  });

  it("allows administrators to inspect an individual user", async () => {
    const admin = await createLoggedInUser("admin-detail", true);
    const target = await createLoggedInUser("admin-target");

    const targetUser = await prisma.user.findUniqueOrThrow({
      where: { email: target.email },
      select: { id: true },
    });

    const response = await request(app)
      .get(`/api/v1/admin/users/${targetUser.id}`)
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(target.email);
    expect(response.body.data.user.role).toBe("USER");
    expect(response.body.data.user.profile.displayName).toBe("Admin Test");

    const serializedResponse = JSON.stringify(response.body);

    expect(serializedResponse).not.toContain("passwordHash");
    expect(serializedResponse).not.toContain("password_hash");
    expect(serializedResponse).not.toContain("refreshToken");
    expect(serializedResponse).not.toContain("accessToken");
  });

  it("rejects invalid user IDs", async () => {
    const admin = await createLoggedInUser("admin-invalid-id", true);

    const response = await request(app)
      .get("/api/v1/admin/users/not-a-uuid")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent users", async () => {
    const admin = await createLoggedInUser("admin-not-found", true);

    const response = await request(app)
      .get(`/api/v1/admin/users/${randomUUID()}`)
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("searches users by email and display name", async () => {
    const admin = await createLoggedInUser("admin-search", true);
    const target = await createLoggedInUser("unique-search-target");

    const emailSearch = await request(app)
      .get(`/api/v1/admin/users?search=${encodeURIComponent(target.email)}`)
      .set("Cookie", admin.accessCookie);

    expect(emailSearch.status).toBe(200);
    expect(emailSearch.body.data).toHaveLength(1);
    expect(emailSearch.body.data[0].email).toBe(target.email);

    const nameSearch = await request(app)
      .get("/api/v1/admin/users?search=Admin%20Test")
      .set("Cookie", admin.accessCookie);

    expect(nameSearch.status).toBe(200);
    expect(nameSearch.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("paginates user listings", async () => {
    const admin = await createLoggedInUser("admin-pagination", true);

    await createLoggedInUser("admin-pagination-user-1");
    await createLoggedInUser("admin-pagination-user-2");

    const response = await request(app)
      .get("/api/v1/admin/users?page=1&limit=2")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);

    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
    });

    expect(response.body.pagination.totalItems).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid pagination parameters", async () => {
    const admin = await createLoggedInUser("admin-invalid-pagination", true);

    const response = await request(app)
      .get("/api/v1/admin/users?page=0&limit=101")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Admin project inspection", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app).get("/api/v1/admin/projects");

    expect(response.status).toBe(401);
  });

  it("rejects authenticated non-admin users", async () => {
    const user = await createLoggedInUser("admin-project-forbidden");

    const response = await request(app)
      .get("/api/v1/admin/projects")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows administrators to list projects from different owners", async () => {
    const admin = await createLoggedInUser("admin-project-list", true);
    const ownerOne = await createLoggedInUser("admin-project-owner-one");
    const ownerTwo = await createLoggedInUser("admin-project-owner-two");

    await prisma.project.create({
      data: {
        ownerId: ownerOne.email
          ? (
              await prisma.user.findUniqueOrThrow({
                where: { email: ownerOne.email },
                select: { id: true },
              })
            ).id
          : "",
        name: "Admin Inspection Project One",
      },
    });

    await prisma.project.create({
      data: {
        ownerId: (
          await prisma.user.findUniqueOrThrow({
            where: { email: ownerTwo.email },
            select: { id: true },
          })
        ).id,
        name: "Admin Inspection Project Two",
      },
    });

    const response = await request(app)
      .get("/api/v1/admin/projects")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Admin Inspection Project One",
        }),
        expect.objectContaining({
          name: "Admin Inspection Project Two",
        }),
      ]),
    );
    expect(response.body.pagination).toBeDefined();
  });
  it("searches projects by name", async () => {
    const admin = await createLoggedInUser("admin-project-search", true);
    const owner = await createLoggedInUser("admin-project-search-owner");

    await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Unique Admin Search Project",
      },
    });

    await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Unrelated Project",
      },
    });

    const response = await request(app)
      .get("/api/v1/admin/projects?search=Unique%20Admin%20Search")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe("Unique Admin Search Project");
  });

  it("filters archived and active projects", async () => {
    const admin = await createLoggedInUser("admin-project-archive", true);
    const owner = await createLoggedInUser("admin-project-archive-owner");

    const activeProject = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Active Admin Project",
      },
    });

    await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived Admin Project",
        archivedAt: new Date(),
      },
    });

    const activeResponse = await request(app)
      .get("/api/v1/admin/projects?archived=false")
      .set("Cookie", admin.accessCookie);

    expect(activeResponse.status).toBe(200);
    expect(
      activeResponse.body.data.some(
        (project: { id: string }) => project.id === activeProject.id,
      ),
    ).toBe(true);
    expect(
      activeResponse.body.data.every(
        (project: { archivedAt: string | null }) => project.archivedAt === null,
      ),
    ).toBe(true);

    const archivedResponse = await request(app)
      .get("/api/v1/admin/projects?archived=true")
      .set("Cookie", admin.accessCookie);

    expect(archivedResponse.status).toBe(200);
    expect(
      archivedResponse.body.data.some(
        (project: { name: string }) =>
          project.name === "Archived Admin Project",
      ),
    ).toBe(true);
    expect(
      archivedResponse.body.data.every(
        (project: { archivedAt: string | null }) => project.archivedAt !== null,
      ),
    ).toBe(true);
  });
  it("allows administrators to inspect a project and its memberships", async () => {
    const admin = await createLoggedInUser("admin-project-detail", true);
    const owner = await createLoggedInUser("admin-project-detail-owner");
    const member = await createLoggedInUser("admin-project-detail-member");

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Detailed Admin Project",
        description: "A project for administrator inspection.",
      },
    });

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const response = await request(app)
      .get(`/api/v1/admin/projects/${project.id}`)
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);

    expect(response.body.data.project).toMatchObject({
      id: project.id,
      name: "Detailed Admin Project",
      description: "A project for administrator inspection.",
      owner: {
        id: owner.userId,
        email: owner.email,
      },
    });

    expect(response.body.data.project.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: {
            id: member.userId,
            email: member.email,
            status: "ACTIVE",
            profile: {
              displayName: "Admin Test",
            },
          },
        }),
      ]),
    );
  });
  it("rejects invalid project IDs", async () => {
    const admin = await createLoggedInUser("admin-project-invalid-id", true);

    const response = await request(app)
      .get("/api/v1/admin/projects/not-a-uuid")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for nonexistent projects", async () => {
    const admin = await createLoggedInUser("admin-project-not-found", true);

    const response = await request(app)
      .get(`/api/v1/admin/projects/${randomUUID()}`)
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROJECT_NOT_FOUND");
  });
  it("inspects tasks, labels, comments, and attachment metadata without exposing private data", async () => {
    const admin = await createLoggedInUser("admin-nested", true);
    const owner = await createLoggedInUser("admin-nested-owner");
    const member = await createLoggedInUser("admin-nested-member");

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Nested Inspection Project",
      },
    });

    const membership = await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Important",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Inspect this task",
        description: "Task inspection test.",
        status: "IN_PROGRESS",
        priority: "HIGH",
        assigneeId: membership.userId,
        archivedAt: new Date(),
      },
    });

    await prisma.taskLabel.create({
      data: {
        projectId: project.id,
        taskId: task.id,
        labelId: label.id,
      },
    });

    await prisma.taskComment.createMany({
      data: [
        {
          taskId: task.id,
          authorId: member.userId,
          body: "Visible comment content.",
        },
        {
          taskId: task.id,
          authorId: member.userId,
          body: "This deleted content must remain private.",
          deletedAt: new Date(),
        },
      ],
    });

    await prisma.attachment.create({
      data: {
        taskId: task.id,
        uploaderId: member.userId,
        filename: "example.pdf",
        contentType: "application/pdf",
        size: 1024,
        storageKey: `admin-test/${randomUUID()}/example.pdf`,
      },
    });

    const response = await request(app)
      .get(`/api/v1/admin/projects/${project.id}`)
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);

    const inspectedProject = response.body.data.project;
    expect(inspectedProject.tasks).toHaveLength(1);

    const inspectedTask = inspectedProject.tasks[0];

    expect(inspectedTask).toMatchObject({
      id: task.id,
      title: "Inspect this task",
      status: "IN_PROGRESS",
      priority: "HIGH",
      archivedAt: expect.any(String),
      assignee: {
        user: {
          id: member.userId,
          email: member.email,
        },
      },
    });

    expect(inspectedTask.labels).toEqual([
      {
        label: {
          id: label.id,
          name: "Important",
        },
      },
    ]);

    expect(inspectedTask.comments).toHaveLength(2);

    expect(inspectedTask.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "Visible comment content.",
          isDeleted: false,
        }),
        expect.objectContaining({
          body: "This comment has been deleted.",
          isDeleted: true,
        }),
      ]),
    );

    expect(inspectedTask.attachments).toHaveLength(1);

    expect(inspectedTask.attachments[0]).toMatchObject({
      filename: "example.pdf",
      contentType: "application/pdf",
      size: 1024,
      uploaderId: member.userId,
    });

    const serializedResponse = JSON.stringify(response.body);

    expect(serializedResponse).not.toContain(
      "This deleted content must remain private.",
    );
    expect(serializedResponse).not.toContain("storageKey");
    expect(serializedResponse).not.toContain("admin-test/");
    expect(serializedResponse).not.toContain("passwordHash");
    expect(serializedResponse).not.toContain("profilePictureKey");
  });
  it("paginates project listings", async () => {
    const admin = await createLoggedInUser("admin-project-pagination", true);
    const owner = await createLoggedInUser("admin-project-pagination-owner");

    await prisma.project.createMany({
      data: [
        {
          ownerId: owner.userId,
          name: "Pagination Project One",
        },
        {
          ownerId: owner.userId,
          name: "Pagination Project Two",
        },
      ],
    });

    const response = await request(app)
      .get("/api/v1/admin/projects?page=1&limit=2")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
    });
    expect(response.body.pagination.totalItems).toBeGreaterThanOrEqual(2);
  });

  it("rejects invalid project pagination parameters", async () => {
    const admin = await createLoggedInUser(
      "admin-project-invalid-pagination",
      true,
    );

    const response = await request(app)
      .get("/api/v1/admin/projects?page=0&limit=101")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("prevents non-admin users from inspecting individual projects", async () => {
    const owner = await createLoggedInUser("admin-project-access-owner");
    const regularUser = await createLoggedInUser("admin-project-access-user");

    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Private Inspection Project",
      },
    });

    const response = await request(app)
      .get(`/api/v1/admin/projects/${project.id}`)
      .set("Cookie", regularUser.accessCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});

it("deactivates a user and revokes all their sessions and refresh tokens", async () => {
  const admin = await createLoggedInUser("deactivate-admin", true);
  const target = await createLoggedInUser("deactivate-target");

  // Create a second session for the target user.
  const secondLogin = await request(app).post("/api/v1/auth/login").send({
    email: target.email,
    password: "A-Strong-Test-Password-123!",
  });

  expect(secondLogin.status).toBe(200);

  const secondHeaders = Array.isArray(secondLogin.headers["set-cookie"])
    ? secondLogin.headers["set-cookie"]
    : [];

  const secondAccessCookie = getCookiePair(secondHeaders, "access_token");
  const secondRefreshCookie = getCookiePair(secondHeaders, "refresh_token");

  expect(secondAccessCookie).toBeDefined();
  expect(secondRefreshCookie).toBeDefined();

  // Deactivate the target account.
  const response = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
    .set("Cookie", admin.accessCookie)
    .set("X-CSRF-Token", admin.csrfToken);

  expect(response.status).toBe(200);
  expect(response.body.data.user).toEqual({
    id: target.userId,
    status: "DISABLED",
  });

  // Verify the account is disabled and every session/token is revoked.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
    include: {
      authSessions: {
        include: { refreshTokens: true },
      },
    },
  });

  expect(user.status).toBe("DISABLED");
  expect(user.authSessions).toHaveLength(2);

  for (const session of user.authSessions) {
    expect(session.revokedAt).not.toBeNull();
    expect(session.refreshTokens.length).toBeGreaterThan(0);
    expect(
      session.refreshTokens.every((token) => token.revokedAt !== null),
    ).toBe(true);
  }

  // Neither old access session should work.
  const firstMeResponse = await request(app)
    .get("/api/v1/auth/me")
    .set("Cookie", target.accessCookie);

  const secondMeResponse = await request(app)
    .get("/api/v1/auth/me")
    .set("Cookie", secondAccessCookie!);

  expect(firstMeResponse.status).toBe(401);
  expect(secondMeResponse.status).toBe(401);

  // Neither old refresh token should work.
  const firstRefreshResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", target.rawRefreshToken);

  const secondRefreshResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", secondRefreshCookie!);

  expect(firstRefreshResponse.status).toBe(401);
  expect(secondRefreshResponse.status).toBe(401);
});

it("does not leave an active session when login races with account deactivation", async () => {
  const admin = await createLoggedInUser("race-admin", true);
  const target = await createLoggedInUser("race-target");

  const [loginResponse, deactivateResponse] = await Promise.all([
    request(app).post("/api/v1/auth/login").send({
      email: target.email,
      password: "A-Strong-Test-Password-123!",
    }),
    request(app)
      .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
      .set("Cookie", admin.accessCookie)
      .set("X-CSRF-Token", admin.csrfToken),
  ]);

  expect([200, 401]).toContain(loginResponse.status);
  expect(deactivateResponse.status).toBe(200);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
    include: {
      authSessions: {
        include: { refreshTokens: true },
      },
    },
  });

  expect(user.status).toBe("DISABLED");

  for (const session of user.authSessions) {
    expect(session.revokedAt).not.toBeNull();

    for (const token of session.refreshTokens) {
      expect(token.revokedAt).not.toBeNull();
    }
  }
});

it("reactivates a user without restoring their old sessions", async () => {
  const admin = await createLoggedInUser("reactivate-admin", true);
  const target = await createLoggedInUser("reactivate-target");

  // First deactivate the target.
  const deactivateResponse = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
    .set("Cookie", admin.accessCookie)
    .set("X-CSRF-Token", admin.csrfToken);

  expect(deactivateResponse.status).toBe(200);

  // Then reactivate the account.
  const reactivateResponse = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/reactivate`)
    .set("Cookie", admin.accessCookie)
    .set("X-CSRF-Token", admin.csrfToken);

  expect(reactivateResponse.status).toBe(200);
  expect(reactivateResponse.body.data.user.status).toBe("ACTIVE");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
    include: {
      authSessions: {
        include: { refreshTokens: true },
      },
    },
  });

  expect(user.status).toBe("ACTIVE");
  expect(user.authSessions).toHaveLength(1);
  expect(user.authSessions[0].revokedAt).not.toBeNull();
  expect(
    user.authSessions[0].refreshTokens.every(
      (token) => token.revokedAt !== null,
    ),
  ).toBe(true);

  // Reactivation must not restore the old access or refresh token.
  const oldMeResponse = await request(app)
    .get("/api/v1/auth/me")
    .set("Cookie", target.accessCookie);

  const oldRefreshResponse = await request(app)
    .post("/api/v1/auth/refresh")
    .set("Cookie", target.rawRefreshToken);

  expect(oldMeResponse.status).toBe(401);
  expect(oldRefreshResponse.status).toBe(401);

  // A fresh login should work.
  const newLogin = await request(app).post("/api/v1/auth/login").send({
    email: target.email,
    password: "A-Strong-Test-Password-123!",
  });

  expect(newLogin.status).toBe(200);
});

it("prevents an administrator from deactivating their own account", async () => {
  const admin = await createLoggedInUser("self-deactivate-admin", true);

  const response = await request(app)
    .patch(`/api/v1/admin/users/${admin.userId}/deactivate`)
    .set("Cookie", admin.accessCookie)
    .set("X-CSRF-Token", admin.csrfToken);

  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe("CANNOT_DEACTIVATE_SELF");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: admin.userId },
  });

  expect(user.status).toBe("ACTIVE");
});

it("rejects account management by non-admin users", async () => {
  const user = await createLoggedInUser("account-management-user");
  const target = await createLoggedInUser("account-management-target");

  const deactivateResponse = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
    .set("Cookie", user.accessCookie)
    .set("X-CSRF-Token", user.csrfToken);

  const reactivateResponse = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/reactivate`)
    .set("Cookie", user.accessCookie)
    .set("X-CSRF-Token", user.csrfToken);

  expect(deactivateResponse.status).toBe(403);
  expect(reactivateResponse.status).toBe(403);

  const targetAfter = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
  });

  expect(targetAfter.status).toBe("ACTIVE");
});

it("rejects account management without a CSRF token", async () => {
  const admin = await createLoggedInUser("csrf-account-admin", true);
  const target = await createLoggedInUser("csrf-account-target");

  const response = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
    .set("Cookie", admin.accessCookie);

  expect(response.status).toBe(403);

  const targetAfter = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
  });

  expect(targetAfter.status).toBe("ACTIVE");
});

it("handles repeated deactivation requests idempotently", async () => {
  const admin = await createLoggedInUser("repeat-deactivate-admin", true);
  const target = await createLoggedInUser("repeat-deactivate-target");

  const deactivate = () =>
    request(app)
      .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
      .set("Cookie", admin.accessCookie)
      .set("X-CSRF-Token", admin.csrfToken);

  const first = await deactivate();
  const second = await deactivate();

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.body.data.user.status).toBe("DISABLED");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
  });

  expect(user.status).toBe("DISABLED");
});

it("handles repeated reactivation requests idempotently", async () => {
  const admin = await createLoggedInUser("repeat-reactivate-admin", true);
  const target = await createLoggedInUser("repeat-reactivate-target");

  const deactivate = await request(app)
    .patch(`/api/v1/admin/users/${target.userId}/deactivate`)
    .set("Cookie", admin.accessCookie)
    .set("X-CSRF-Token", admin.csrfToken);

  expect(deactivate.status).toBe(200);

  const reactivate = () =>
    request(app)
      .patch(`/api/v1/admin/users/${target.userId}/reactivate`)
      .set("Cookie", admin.accessCookie)
      .set("X-CSRF-Token", admin.csrfToken);

  const first = await reactivate();
  const second = await reactivate();

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(second.body.data.user.status).toBe("ACTIVE");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: target.userId },
  });

  expect(user.status).toBe("ACTIVE");
});
