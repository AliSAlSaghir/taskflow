import { randomUUID } from "node:crypto";
import argon2 from "argon2";
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

    if (user) {
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
  }

  emailsToClean.length = 0;
});

describe("POST /api/v1/auth/register", () => {
  it("creates a user and profile without exposing the password hash", async () => {
    const email = `register-${randomUUID()}@example.com`;
    const password = "A-Strong-Test-Password-123!";
    emailsToClean.push(email);

    const response = await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      displayName: "Test User",
    });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe(email);
    expect(response.body.data.profile.displayName).toBe("Test User");
    expect(response.body.data).not.toHaveProperty("passwordHash");
    expect(response.body.data).not.toHaveProperty("password");

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    expect(user).not.toBeNull();

    if (!user) {
      throw new Error("Expected the registered user to exist.");
    }

    expect(user.passwordHash).not.toBe(password);
    expect(await argon2.verify(user.passwordHash, password)).toBe(true);
    expect(user.profile?.displayName).toBe("Test User");
  });

  it("rejects invalid registration input", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({
      email: "not-an-email",
      password: "short",
      displayName: "A",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate emails regardless of capitalization", async () => {
    const email = `duplicate-${randomUUID()}@example.com`;
    emailsToClean.push(email);

    const firstResponse = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email,
        password: "A-Strong-Test-Password-123!",
        displayName: "First User",
      });

    expect(firstResponse.status).toBe(201);

    const duplicateResponse = await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: email.toUpperCase(),
        password: "Another-Strong-Password-123!",
        displayName: "Second User",
      });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with valid credentials", async () => {
    const email = `login-${randomUUID()}@example.com`;
    const password = "A-Strong-Test-Password-123!";
    emailsToClean.push(email);

    const registration = await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      displayName: "Login Test",
    });

    expect(registration.status).toBe(201);

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("access_token="),
        expect.stringContaining("HttpOnly"),
        expect.stringContaining("SameSite=Lax"),
      ]),
    );
    expect(response.body.data.email).toBe(email);
    expect(response.body.data.profile.displayName).toBe("Login Test");
    expect(response.body.data).not.toHaveProperty("passwordHash");
  });

  it("rejects an incorrect password with a generic error", async () => {
    const email = `login-${randomUUID()}@example.com`;
    emailsToClean.push(email);

    await request(app).post("/api/v1/auth/register").send({
      email,
      password: "A-Strong-Test-Password-123!",
      displayName: "Login Test",
    });

    const response = await request(app).post("/api/v1/auth/login").send({
      email,
      password: "Wrong-Password-123!",
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  });

  it("returns the same error for a nonexistent account", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: `missing-${randomUUID()}@example.com`,
        password: "A-Strong-Test-Password-123!",
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  });

  it("rejects invalid login input", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({
      email: "not-an-email",
      password: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects login for a disabled account", async () => {
    const email = `disabled-${randomUUID()}@example.com`;
    const password = "A-Strong-Test-Password-123!";
    emailsToClean.push(email);

    const registration = await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      displayName: "Disabled User",
    });

    expect(registration.status).toBe(201);

    await prisma.user.update({
      where: { email },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  });

  it("allows an authenticated user to access /me", async () => {
    const email = `me-${randomUUID()}@example.com`;
    const password = "A-Strong-Test-Password-123!";
    emailsToClean.push(email);

    await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      displayName: "Me Test",
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(loginResponse.status).toBe(200);

    const cookieHeader = loginResponse.headers["set-cookie"];
    const cookies = cookieHeader
      ? Array.isArray(cookieHeader)
        ? cookieHeader
        : [cookieHeader]
      : undefined;

    expect(cookies).toBeDefined();

    const accessCookie = cookies?.find((cookie) =>
      cookie.startsWith("access_token="),
    );

    expect(accessCookie).toBeDefined();

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", accessCookie!.split(";")[0]);

    expect(response.status).toBe(200);
    expect(response.body.data.userId).toBeDefined();
  });

  it("rejects requests to /me without an access cookie", async () => {
    const response = await request(app).get("/api/v1/auth/me");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects requests to /me with an invalid access token", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", "access_token=not-a-valid-jwt");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an existing token after the account is disabled", async () => {
    const email = `disabled-token-${randomUUID()}@example.com`;
    const password = "A-Strong-Test-Password-123!";
    emailsToClean.push(email);

    await request(app).post("/api/v1/auth/register").send({
      email,
      password,
      displayName: "Disabled Token Test",
    });

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password });

    expect(loginResponse.status).toBe(200);

    const cookieHeader = loginResponse.headers["set-cookie"];
    const cookies = cookieHeader
      ? Array.isArray(cookieHeader)
        ? cookieHeader
        : [cookieHeader]
      : undefined;
    const accessCookie = cookies?.find((cookie) =>
      cookie.startsWith("access_token="),
    );

    expect(accessCookie).toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", accessCookie!.split(";")[0]);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
