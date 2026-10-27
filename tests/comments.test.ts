import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from "../src/modules/comments/comment.schema.js";

const emailsToClean: string[] = [];

afterEach(async () => {
  for (const email of emailsToClean) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) continue;

    const projects = await prisma.project.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    });

    const projectIds = projects.map((project) => project.id);

    // Comments must be removed before their tasks or authors.
    await prisma.taskComment.deleteMany({
      where: {
        OR: [
          { authorId: user.id },
          { task: { project: { ownerId: user.id } } },
        ],
      },
    });

    if (projectIds.length > 0) {
      await prisma.taskLabel.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await prisma.label.deleteMany({
        where: { projectId: { in: projectIds } },
      });

      await prisma.task.deleteMany({
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

async function createLoggedInUser() {
  const email = `comments-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Comments Test",
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

async function createProject(ownerId: string, name = "Comments Test Project") {
  return prisma.project.create({
    data: { ownerId, name },
  });
}

async function createTask(projectId: string, title = "Comments Test Task") {
  return prisma.task.create({
    data: { projectId, title },
  });
}

describe("Comment schemas", () => {
  it("trims a valid comment body", () => {
    expect(createCommentSchema.parse({ body: "  Hello  " }).body).toBe("Hello");
    expect(updateCommentSchema.parse({ body: "  Updated  " }).body).toBe(
      "Updated",
    );
  });

  it("rejects empty or oversized comment bodies", () => {
    expect(createCommentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(
      createCommentSchema.safeParse({ body: "a".repeat(5001) }).success,
    ).toBe(false);
  });

  it("applies defaults to pagination", () => {
    expect(listCommentsQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 10,
    });
  });
});

describe("POST /api/v1/projects/:projectId/tasks/:taskId/comments", () => {
  it("allows a project owner to create a comment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie)
      .send({ body: "  First comment  " });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      taskId: task.id,
      authorId: owner.userId,
      body: "First comment",
      isDeleted: false,
      deletedAt: null,
      author: {
        id: owner.userId,
        displayName: "Comments Test",
      },
    });
    expect(response.body.data.id).toEqual(expect.any(String));

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(storedComment.body).toBe("First comment");
    expect(storedComment.deletedAt).toBeNull();
  });

  it("rejects unauthenticated requests", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .send({ body: "Unauthenticated comment" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects invalid comment bodies", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie)
      .send({ body: "   ", unexpectedField: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");

    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(
      0,
    );
  });
});

describe("GET /api/v1/projects/:projectId/tasks/:taskId/comments", () => {
  it("allows the project owner to list comments in chronological order", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const olderComment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Older comment",
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    });

    const newerComment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Newer comment",
        createdAt: new Date("2026-01-02T10:00:00.000Z"),
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(
      response.body.data.map((comment: { id: string }) => comment.id),
    ).toEqual([olderComment.id, newerComment.id]);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      totalItems: 2,
      totalPages: 1,
    });
  });

  it("allows an active project member to list comments", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Comment from the owner",
      },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].body).toBe("Comment from the owner");
  });

  it("hides comments from a disabled project member", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    // Keep the membership row, but disable the member's account.
    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Private project comment",
      },
    });

    await prisma.user.update({
      where: { id: member.userId },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("hides comments from a non-member", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("paginates comment results", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.taskComment.createMany({
      data: [
        { taskId: task.id, authorId: owner.userId, body: "First" },
        { taskId: task.id, authorId: owner.userId, body: "Second" },
        { taskId: task.id, authorId: owner.userId, body: "Third" },
      ],
    });

    const response = await request(app)
      .get(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments?page=2&limit=2`,
      )
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
});

describe("PATCH /api/v1/projects/:projectId/tasks/:taskId/comments/:commentId", () => {
  it("allows the author to edit their own comment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Original comment",
      },
    });

    const response = await request(app)
      .patch(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie)
      .send({ body: "Updated comment" });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: comment.id,
      body: "Updated comment",
      isDeleted: false,
    });

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    expect(storedComment.body).toBe("Updated comment");
  });

  it("does not allow another project member to edit the author's comment", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Author's original comment",
      },
    });

    const response = await request(app)
      .patch(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", member.accessCookie)
      .send({ body: "Unauthorized edit" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    expect(storedComment.body).toBe("Author's original comment");
  });

  it("returns 404 when the comment does not belong to the URL task", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const firstTask = await createTask(project.id, "First task");
    const secondTask = await createTask(project.id, "Second task");

    const comment = await prisma.taskComment.create({
      data: {
        taskId: firstTask.id,
        authorId: owner.userId,
        body: "Comment on the first task",
      },
    });

    const response = await request(app)
      .patch(
        `/api/v1/projects/${project.id}/tasks/${secondTask.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie)
      .send({ body: "Attempted edit" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/v1/projects/:projectId/tasks/:taskId/comments/:commentId", () => {
  it("soft-deletes a comment without exposing its original body", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "This private text must be hidden after deletion",
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: comment.id,
      body: "This comment has been deleted.",
      isDeleted: true,
      authorId: owner.userId,
    });
    expect(response.body.data.deletedAt).toEqual(expect.any(String));
    expect(response.body.data.body).not.toContain(
      "This private text must be hidden after deletion",
    );

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    // Preserve the original text in storage, but never return it after deletion.
    expect(storedComment.body).toBe(
      "This private text must be hidden after deletion",
    );
    expect(storedComment.deletedAt).not.toBeNull();

    const listResponse = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data[0]).toMatchObject({
      id: comment.id,
      body: "This comment has been deleted.",
      isDeleted: true,
    });
    expect(JSON.stringify(listResponse.body)).not.toContain(
      "This private text must be hidden after deletion",
    );
  });

  it("does not allow another project member to delete the author's comment", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: {
        projectId: project.id,
        userId: member.userId,
      },
    });

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Keep this comment",
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    expect(storedComment.deletedAt).toBeNull();
  });

  it("returns 404 when attempting to edit an already deleted comment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Already deleted",
        deletedAt: new Date(),
      },
    });

    const response = await request(app)
      .patch(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie)
      .send({ body: "Try editing it" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when attempting to delete an already deleted comment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Already deleted",
        deletedAt: new Date(),
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});

describe("Comment access to archived resources", () => {
  it("allows reading comments on an archived task but rejects new comments", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        archivedAt: new Date(),
      },
    });

    await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Historical comment",
      },
    });

    const listResponse = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].body).toBe("Historical comment");

    const createResponse = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie)
      .send({ body: "A new comment" });

    expect(createResponse.status).toBe(409);
    expect(createResponse.body.error.code).toBe("COMMENT_RESOURCE_ARCHIVED");
  });

  it("allows reading comments on an archived project but rejects new comments", async () => {
    const owner = await createLoggedInUser();
    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived project",
        archivedAt: new Date(),
      },
    });
    const task = await createTask(project.id);

    await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Historical project comment",
      },
    });

    const listResponse = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data[0].body).toBe("Historical project comment");

    const createResponse = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/comments`)
      .set("Cookie", owner.accessCookie)
      .send({ body: "A new comment" });

    expect(createResponse.status).toBe(409);
    expect(createResponse.body.error.code).toBe("COMMENT_RESOURCE_ARCHIVED");
  });

  it("rejects editing a comment on an archived task", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        archivedAt: new Date(),
      },
    });

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Keep unchanged",
      },
    });

    const response = await request(app)
      .patch(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie)
      .send({ body: "Attempted edit" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("COMMENT_RESOURCE_ARCHIVED");
  });
});

describe("Comment request validation", () => {
  it("rejects malformed UUIDs in comment routes", async () => {
    const owner = await createLoggedInUser();

    const response = await request(app)
      .post("/api/v1/projects/not-a-uuid/tasks/not-a-uuid/comments")
      .set("Cookie", owner.accessCookie)
      .send({ body: "Invalid route IDs" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid pagination values", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .get(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments?page=0&limit=101`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Comment deletion on archived resources", () => {
  it("rejects deleting a comment on an archived task", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        archivedAt: new Date(),
      },
    });

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Keep this comment",
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("COMMENT_RESOURCE_ARCHIVED");

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    expect(storedComment.deletedAt).toBeNull();
  });

  it("rejects deleting a comment on an archived project", async () => {
    const owner = await createLoggedInUser();
    const project = await prisma.project.create({
      data: {
        ownerId: owner.userId,
        name: "Archived project",
        archivedAt: new Date(),
      },
    });
    const task = await createTask(project.id);

    const comment = await prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: owner.userId,
        body: "Keep this comment",
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/comments/${comment.id}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("COMMENT_RESOURCE_ARCHIVED");

    const storedComment = await prisma.taskComment.findUniqueOrThrow({
      where: { id: comment.id },
    });

    expect(storedComment.deletedAt).toBeNull();
  });
});
