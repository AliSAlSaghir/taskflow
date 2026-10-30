import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";

const storageMocks = vi.hoisted(() => ({
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("../src/infrastructure/storage.js", () => storageMocks);

const emailsToClean: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();

  storageMocks.uploadObject.mockResolvedValue(undefined);
  storageMocks.downloadObject.mockResolvedValue({
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    contentType: "image/jpeg",
  });
  storageMocks.deleteObject.mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const email of emailsToClean) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) continue;

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
  const email = `profile-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Profile Test",
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

describe("PATCH /api/v1/profile", () => {
  it("updates the display name", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({ displayName: "  New Display Name  " });

    expect(response.status).toBe(200);
    expect(response.body.data.profile.displayName).toBe("New Display Name");

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    expect(profile.displayName).toBe("New Display Name");
  });

  it("updates the bio and can clear it with null", async () => {
    const user = await createLoggedInUser();

    const updateResponse = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({ bio: "  Learning backend development.  " });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.profile.bio).toBe(
      "Learning backend development.",
    );

    const clearResponse = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({ bio: null });

    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body.data.profile.bio).toBeNull();
  });

  it("rejects an empty update", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid display name", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({ displayName: " " });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a bio longer than 500 characters", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({ bio: "a".repeat(501) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unsupported fields", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .patch("/api/v1/profile")
      .set("Cookie", user.accessCookie)
      .send({
        displayName: "Changed Name",
        userId: randomUUID(),
        role: "ADMIN",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .patch("/api/v1/profile")
      .send({ displayName: "New Name" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
  describe("PUT /api/v1/profile/picture", () => {
    it("uploads a valid JPEG profile picture", async () => {
      const user = await createLoggedInUser();

      const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

      const response = await request(app)
        .put("/api/v1/profile/picture")
        .set("Cookie", user.accessCookie)
        .attach("file", image, {
          filename: "profile.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(200);
      expect(response.body.data.profile.profilePictureKey).toMatch(
        /^profile-pictures\//,
      );

      expect(storageMocks.uploadObject).toHaveBeenCalledOnce();
      expect(storageMocks.uploadObject).toHaveBeenCalledWith(
        expect.stringMatching(/^profile-pictures\//),
        expect.any(Buffer),
        "image/jpeg",
      );

      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId: user.userId },
      });

      expect(profile.profilePictureKey).toBe(
        response.body.data.profile.profilePictureKey,
      );
    });

    it("rejects an upload without a file", async () => {
      const user = await createLoggedInUser();

      const response = await request(app)
        .put("/api/v1/profile/picture")
        .set("Cookie", user.accessCookie);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(storageMocks.uploadObject).not.toHaveBeenCalled();
    });
    it("rejects unsupported file types", async () => {
      const user = await createLoggedInUser();

      const response = await request(app)
        .put("/api/v1/profile/picture")
        .set("Cookie", user.accessCookie)
        .attach("file", Buffer.from("not an image"), {
          filename: "document.pdf",
          contentType: "application/pdf",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(storageMocks.uploadObject).not.toHaveBeenCalled();
    });

    it("rejects images larger than 2 MB", async () => {
      const user = await createLoggedInUser();

      const largeImage = Buffer.alloc(2 * 1024 * 1024 + 1, 0);

      const response = await request(app)
        .put("/api/v1/profile/picture")
        .set("Cookie", user.accessCookie)
        .attach("file", largeImage, {
          filename: "large.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(storageMocks.uploadObject).not.toHaveBeenCalled();
    });

    it("rejects files whose contents do not match their MIME type", async () => {
      const user = await createLoggedInUser();

      const response = await request(app)
        .put("/api/v1/profile/picture")
        .set("Cookie", user.accessCookie)
        .attach("file", Buffer.from("this is not a JPEG"), {
          filename: "fake.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(storageMocks.uploadObject).not.toHaveBeenCalled();
    });
  });
  it("replaces an existing picture and deletes the old one", async () => {
    const user = await createLoggedInUser();

    const firstImage = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const secondImage = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01]);

    const firstUpload = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", firstImage, {
        filename: "first.jpg",
        contentType: "image/jpeg",
      });

    expect(firstUpload.status).toBe(200);

    const oldKey = firstUpload.body.data.profile.profilePictureKey;

    const secondUpload = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", secondImage, {
        filename: "second.jpg",
        contentType: "image/jpeg",
      });

    expect(secondUpload.status).toBe(200);

    const newKey = secondUpload.body.data.profile.profilePictureKey;

    expect(newKey).not.toBe(oldKey);
    expect(storageMocks.uploadObject).toHaveBeenCalledTimes(2);
    expect(storageMocks.deleteObject).toHaveBeenCalledWith(oldKey);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    expect(profile.profilePictureKey).toBe(newKey);
  });
  it("preserves the existing picture when uploading a replacement fails", async () => {
    const user = await createLoggedInUser();

    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const firstUpload = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", image, {
        filename: "first.jpg",
        contentType: "image/jpeg",
      });

    expect(firstUpload.status).toBe(200);

    const oldKey = firstUpload.body.data.profile.profilePictureKey;

    storageMocks.uploadObject.mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );

    const failedUpload = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", image, {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
      });

    expect(failedUpload.status).toBe(502);
    expect(failedUpload.body.error.code).toBe("PROFILE_STORAGE_ERROR");

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    expect(profile.profilePictureKey).toBe(oldKey);
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/profile/:userId/picture", () => {
  it("allows an authenticated user to retrieve another user's picture", async () => {
    const owner = await createLoggedInUser();
    const viewer = await createLoggedInUser();

    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const uploadResponse = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", owner.accessCookie)
      .attach("file", image, {
        filename: "profile.jpg",
        contentType: "image/jpeg",
      });

    expect(uploadResponse.status).toBe(200);

    const response = await request(app)
      .get(`/api/v1/profile/${owner.userId}/picture`)
      .set("Cookie", viewer.accessCookie);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual(image);

    expect(storageMocks.downloadObject).toHaveBeenCalledOnce();
  });

  it("returns 404 when the profile has no picture", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .get(`/api/v1/profile/${user.userId}/picture`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROFILE_PICTURE_NOT_FOUND");
    expect(storageMocks.downloadObject).not.toHaveBeenCalled();
  });

  it("rejects an invalid user ID", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .get("/api/v1/profile/not-a-uuid/picture")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(storageMocks.downloadObject).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const user = await createLoggedInUser();

    const response = await request(app).get(
      `/api/v1/profile/${user.userId}/picture`,
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
  it("returns a storage error when downloading the picture fails", async () => {
    const user = await createLoggedInUser();

    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const uploadResponse = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", image, {
        filename: "profile.jpg",
        contentType: "image/jpeg",
      });

    expect(uploadResponse.status).toBe(200);

    storageMocks.downloadObject.mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );

    const response = await request(app)
      .get(`/api/v1/profile/${user.userId}/picture`)
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("PROFILE_STORAGE_ERROR");
  });
});

describe("DELETE /api/v1/profile/picture", () => {
  it("deletes the authenticated user's profile picture", async () => {
    const user = await createLoggedInUser();

    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const uploadResponse = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", image, {
        filename: "profile.jpg",
        contentType: "image/jpeg",
      });

    expect(uploadResponse.status).toBe(200);

    const pictureKey = uploadResponse.body.data.profile.profilePictureKey;

    const response = await request(app)
      .delete("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.deleted).toBe(true);

    expect(storageMocks.deleteObject).toHaveBeenCalledWith(pictureKey);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    expect(profile.profilePictureKey).toBeNull();
  });

  it("succeeds when deleting the stored image fails", async () => {
    const user = await createLoggedInUser();

    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    const uploadResponse = await request(app)
      .put("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie)
      .attach("file", image, {
        filename: "profile.jpg",
        contentType: "image/jpeg",
      });

    expect(uploadResponse.status).toBe(200);

    const pictureKey = uploadResponse.body.data.profile.profilePictureKey;

    storageMocks.deleteObject.mockRejectedValueOnce(
      new Error("Backblaze deletion failed"),
    );

    const response = await request(app)
      .delete("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.deleted).toBe(true);
    expect(storageMocks.deleteObject).toHaveBeenCalledWith(pictureKey);

    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.userId },
    });

    expect(profile.profilePictureKey).toBeNull();
  });

  it("returns 404 when there is no picture to delete", async () => {
    const user = await createLoggedInUser();

    const response = await request(app)
      .delete("/api/v1/profile/picture")
      .set("Cookie", user.accessCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROFILE_PICTURE_NOT_FOUND");
    expect(storageMocks.deleteObject).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await request(app).delete("/api/v1/profile/picture");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
