import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/infrastructure/storage.js", () => ({
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import {
  deleteObject,
  downloadObject,
  uploadObject,
} from "../src/infrastructure/storage.js";

const emailsToClean: string[] = [];

const fileContents = Buffer.from("TaskFlow attachment test");

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
  const email = `attachments-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Attachments Test",
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

async function createProject(ownerId: string) {
  return prisma.project.create({
    data: { ownerId, name: "Attachments Test Project" },
  });
}

async function createTask(projectId: string) {
  return prisma.task.create({
    data: { projectId, title: "Attachments Test Task" },
  });
}

async function cleanUpTestData() {
  for (const email of emailsToClean) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) continue;

    await prisma.attachment.deleteMany({
      where: {
        OR: [
          { uploaderId: user.id },
          { task: { project: { ownerId: user.id } } },
        ],
      },
    });

    await prisma.taskComment.deleteMany({
      where: {
        OR: [
          { authorId: user.id },
          { task: { project: { ownerId: user.id } } },
        ],
      },
    });

    await prisma.taskLabel.deleteMany({
      where: {
        OR: [
          { task: { project: { ownerId: user.id } } },
          { label: { project: { ownerId: user.id } } },
        ],
      },
    });

    await prisma.label.deleteMany({
      where: { project: { ownerId: user.id } },
    });

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

    await prisma.refreshToken.deleteMany({
      where: { sessionId: { in: sessions.map((session) => session.id) } },
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
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(async () => {
  await cleanUpTestData();
});

describe("Task attachments", () => {
  it("allows a project owner to upload an allowed file", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      taskId: task.id,
      uploaderId: owner.userId,
      filename: "notes.txt",
      contentType: "text/plain",
      size: fileContents.length,
    });
    expect(response.body.data.id).toEqual(expect.any(String));

    expect(uploadObject).toHaveBeenCalledOnce();
    expect(uploadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^attachments\//),
      fileContents,
      "text/plain",
    );

    const storedAttachment = await prisma.attachment.findUniqueOrThrow({
      where: { id: response.body.data.id },
    });

    expect(storedAttachment.filename).toBe("notes.txt");
  });

  it("rejects unauthenticated upload requests", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(401);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "animation.gif",
        contentType: "image/gif",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(uploadObject).not.toHaveBeenCalled();

    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(
      0,
    );
  });

  it("rejects uploads by a project member who is not the owner", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", member.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("rejects uploads to archived projects", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.project.update({
      where: { id: project.id },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ATTACHMENT_RESOURCE_ARCHIVED");
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("rejects files whose contents do not match their declared type", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(uploadObject).not.toHaveBeenCalled();

    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(
      0,
    );
  });

  it("returns a storage error when the upload fails", async () => {
    vi.mocked(uploadObject).mockRejectedValueOnce(
      new Error("Simulated storage failure"),
    );

    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("ATTACHMENT_STORAGE_ERROR");

    expect(await prisma.attachment.count({ where: { taskId: task.id } })).toBe(
      0,
    );
  });

  it("allows a project owner to list task attachments", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: upload.body.data.id,
      taskId: task.id,
      uploaderId: owner.userId,
      filename: "notes.txt",
      contentType: "text/plain",
      size: fileContents.length,
    });

    // Listing metadata must not download the file from object storage.
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("allows a project owner to download an attachment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    vi.mocked(downloadObject).mockResolvedValueOnce({
      body: fileContents,
      contentType: "text/plain",
    });

    const response = await request(app)
      .get(
        `/api/v1/projects/${project.id}/tasks/${task.id}/attachments/${upload.body.data.id}`,
      )
      .set("Cookie", owner.accessCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on("end", () => {
          callback(null, Buffer.concat(chunks));
        });
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-disposition"]).toContain("notes.txt");
    expect(response.headers["content-length"]).toBe(
      String(fileContents.length),
    );
    expect(response.body).toEqual(fileContents);

    expect(downloadObject).toHaveBeenCalledOnce();
    expect(downloadObject).toHaveBeenCalledWith(
      expect.stringMatching(/^attachments\//),
    );
  });

  it("allows a project owner to delete an attachment", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    const attachmentId = upload.body.data.id as string;

    const attachment = await prisma.attachment.findUniqueOrThrow({
      where: { id: attachmentId },
      select: { storageKey: true },
    });

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/attachments/${attachmentId}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ id: attachmentId });

    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith(attachment.storageKey);

    expect(
      await prisma.attachment.findUnique({
        where: { id: attachmentId },
      }),
    ).toBeNull();
  });

  it("allows an active project member to list attachments", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    const response = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: upload.body.data.id,
      filename: "notes.txt",
      taskId: task.id,
    });
  });

  it("allows an active project member to download an attachment", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    vi.mocked(downloadObject).mockResolvedValueOnce({
      body: fileContents,
      contentType: "text/plain",
    });

    const response = await request(app)
      .get(
        `/api/v1/projects/${project.id}/tasks/${task.id}/attachments/${upload.body.data.id}`,
      )
      .set("Cookie", member.accessCookie)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on("end", () => {
          callback(null, Buffer.concat(chunks));
        });
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(fileContents);
    expect(downloadObject).toHaveBeenCalledOnce();
  });

  it("does not allow a project member to delete an attachment", async () => {
    const owner = await createLoggedInUser();
    const member = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);

    await prisma.projectMembership.create({
      data: { projectId: project.id, userId: member.userId },
    });

    const upload = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", fileContents, {
        filename: "notes.txt",
        contentType: "text/plain",
      });

    expect(upload.status).toBe(201);

    const attachmentId = upload.body.data.id as string;

    const response = await request(app)
      .delete(
        `/api/v1/projects/${project.id}/tasks/${task.id}/attachments/${attachmentId}`,
      )
      .set("Cookie", member.accessCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(deleteObject).not.toHaveBeenCalled();

    expect(
      await prisma.attachment.findUnique({
        where: { id: attachmentId },
      }),
    ).not.toBeNull();
  });

  it("returns 404 when the attachment does not exist", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);
    const nonexistentAttachmentId = randomUUID();

    const response = await request(app)
      .get(
        `/api/v1/projects/${project.id}/tasks/${task.id}/attachments/${nonexistentAttachmentId}`,
      )
      .set("Cookie", owner.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(downloadObject).not.toHaveBeenCalled();
  });
  it("rejects files larger than 5 MB", async () => {
    const owner = await createLoggedInUser();
    const project = await createProject(owner.userId);
    const task = await createTask(project.id);
    const oversizedFile = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/tasks/${task.id}/attachments`)
      .set("Cookie", owner.accessCookie)
      .attach("file", oversizedFile, {
        filename: "large.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
