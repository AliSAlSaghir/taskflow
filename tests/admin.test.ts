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

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return {
    email,
    userId: user.id,
    accessCookie: accessCookie!,
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

    const response = await request(app)
      .get("/api/v1/admin/users?page=1&limit=2")
      .set("Cookie", admin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 2,
    });
    expect(response.body.pagination.totalItems).toBeGreaterThanOrEqual(2);
    expect(response.body.pagination.totalPages).toBeGreaterThanOrEqual(1);
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
