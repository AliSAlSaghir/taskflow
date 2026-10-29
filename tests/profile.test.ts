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
});
