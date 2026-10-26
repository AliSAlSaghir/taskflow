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

    const projects = await prisma.project.findMany({
      where: { ownerId: user.id },
      select: { id: true },
    });

    const projectIds = projects.map((project) => project.id);

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
  const email = `labels-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Labels Test",
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

async function createProject(ownerId: string, name = "Labels Test Project") {
  return prisma.project.create({
    data: {
      ownerId,
      name,
    },
  });
}

describe("POST /api/v1/projects/:projectId/labels", () => {
  it("creates a label for a project owned by the authenticated user", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie)
      .send({ name: " Bug " });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      projectId: project.id,
      name: "Bug",
    });
    expect(response.body.data.id).toEqual(expect.any(String));

    const storedLabel = await prisma.label.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: response.body.data.id,
        },
      },
    });

    expect(storedLabel?.name).toBe("Bug");
  });

  it("rejects unauthenticated requests", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .send({ name: "Bug" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects duplicate label names within the same project", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const firstResponse = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Bug" });

    expect(firstResponse.status).toBe(201);

    const secondResponse = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Bug" });

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.error.code).toBe("DUPLICATE_LABEL");
  });

  it("rejects invalid label names", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    for (const name of ["", "   ", "x".repeat(51)]) {
      const response = await request(app)
        .post(`/api/v1/projects/${project.id}/labels`)
        .set("Cookie", user.accessCookie)
        .send({ name });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("does not allow another user to create labels in the project", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", otherUser.accessCookie)
      .send({ name: "Unauthorized Label" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const label = await prisma.label.findFirst({
      where: {
        projectId: project.id,
        name: "Unauthorized Label",
      },
    });

    expect(label).toBeNull();
  });

  it("rejects label creation for archived projects", async () => {
    const user = await createLoggedInUser();
    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Archived Labels Project",
        archivedAt: new Date(),
      },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie)
      .send({ name: "Bug" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROJECT_ARCHIVED");
  });
});

describe("GET /api/v1/projects/:projectId/labels", () => {
  it("lists labels alphabetically", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    await prisma.label.createMany({
      data: [
        { projectId: project.id, name: "Urgent" },
        { projectId: project.id, name: "Bug" },
        { projectId: project.id, name: "Feature" },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(
      response.body.data.map((label: { name: string }) => label.name),
    ).toEqual(["Bug", "Feature", "Urgent"]);
  });

  it("does not allow another user to list project labels", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    await prisma.label.create({
      data: { projectId: project.id, name: "Private Label" },
    });

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("returns an empty list when the project has no labels", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/labels`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });
});

describe("DELETE /api/v1/projects/:projectId/labels/:labelId", () => {
  it("deletes a label without deleting its associated task", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task that must survive label deletion",
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
      .delete(`/api/v1/projects/${project.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(204);

    const storedLabel = await prisma.label.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: label.id,
        },
      },
    });

    const storedTask = await prisma.task.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: task.id,
        },
      },
    });

    const associations = await prisma.taskLabel.findMany({
      where: {
        projectId: project.id,
        labelId: label.id,
      },
    });

    expect(storedLabel).toBeNull();
    expect(storedTask).not.toBeNull();
    expect(associations).toHaveLength(0);
  });

  it("returns 404 when the label does not exist", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/labels/${randomUUID()}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("does not allow another user to delete a label", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Protected Label",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/labels/${label.id}`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const storedLabel = await prisma.label.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: label.id,
        },
      },
    });

    expect(storedLabel).not.toBeNull();
  });

  it("rejects deletion from an archived project", async () => {
    const user = await createLoggedInUser();
    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Archived Project",
        archivedAt: new Date(),
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Protected Label",
      },
    });

    const response = await request(app)
      .delete(`/api/v1/projects/${project.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROJECT_ARCHIVED");

    const storedLabel = await prisma.label.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: label.id,
        },
      },
    });

    expect(storedLabel).not.toBeNull();
  });

  it("rejects unauthenticated requests", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Private Label",
      },
    });

    const response = await request(app).delete(
      `/api/v1/projects/${project.id}/labels/${label.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("does not allow another user to remove a label", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Protected task",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Protected label",
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
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
      )
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).not.toBeNull();
  });

  it("rejects label removal in an archived project", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task",
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

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
      )
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROJECT_ARCHIVED");

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).not.toBeNull();
  });

  it("rejects unauthenticated requests", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const response = await request(app).delete(
      `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("PUT /api/v1/projects/:projectId/tasks/:taskId/labels/:labelId", () => {
  it("assigns a label to a task", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

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

    const response = await request(app)
      .put(`/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(204);

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).not.toBeNull();
  });

  it("does not create duplicate associations when assigning the same label twice", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Repeated assignment",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const url = `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`;

    const firstResponse = await request(app)
      .put(url)
      .set("Cookie", user.accessCookie);

    const secondResponse = await request(app)
      .put(url)
      .set("Cookie", user.accessCookie);

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);

    const associations = await prisma.taskLabel.findMany({
      where: {
        projectId: project.id,
        taskId: task.id,
        labelId: label.id,
      },
    });

    expect(associations).toHaveLength(1);
  });

  it("does not allow another user to assign a label", async () => {
    const owner = await createLoggedInUser();
    const otherUser = await createLoggedInUser();
    const project = await createProject(owner.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Protected task",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Private label",
      },
    });

    const response = await request(app)
      .put(`/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`)
      .set("Cookie", otherUser.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).toBeNull();
  });

  it("rejects a label belonging to another project", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId, "First project");
    const otherProject = await createProject(user.userId, "Second project");

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "First project task",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: otherProject.id,
        name: "Other project's label",
      },
    });

    const response = await request(app)
      .put(`/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).toBeNull();
  });

  it("rejects label assignment to an archived task", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Archived task",
        archivedAt: new Date(),
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const response = await request(app)
      .put(`/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    expect(association).toBeNull();
  });

  it("rejects label assignment in an archived project", async () => {
    const user = await createLoggedInUser();
    const project = await prisma.project.create({
      data: {
        ownerId: user.userId,
        name: "Archived project",
        archivedAt: new Date(),
      },
    });

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task in archived project",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const response = await request(app)
      .put(`/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROJECT_ARCHIVED");
  });

  it("rejects unauthenticated requests", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const response = await request(app).put(
      `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("DELETE /api/v1/projects/:projectId/tasks/:taskId/labels/:labelId", () => {
  it("removes a label association without deleting the task or label", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task that must survive",
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
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
      )
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(204);

    const association = await prisma.taskLabel.findUnique({
      where: {
        taskId_labelId: {
          taskId: task.id,
          labelId: label.id,
        },
      },
    });

    const storedTask = await prisma.task.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: task.id,
        },
      },
    });

    const storedLabel = await prisma.label.findUnique({
      where: {
        projectId_id: {
          projectId: project.id,
          id: label.id,
        },
      },
    });

    expect(association).toBeNull();
    expect(storedTask).not.toBeNull();
    expect(storedLabel).not.toBeNull();
  });

  it("returns 404 when the label is not assigned to the task", async () => {
    const user = await createLoggedInUser();
    const project = await createProject(user.userId);

    const task = await prisma.task.create({
      data: {
        projectId: project.id,
        title: "Task without this label",
      },
    });

    const label = await prisma.label.create({
      data: {
        projectId: project.id,
        name: "Bug",
      },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/labels/${label.id}`,
      )
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
