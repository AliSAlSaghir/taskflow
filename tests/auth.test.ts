import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../src/app/app.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { hashRefreshToken } from "../src/modules/auth/refresh-token.service.js";

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

function getCookiePair(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) {
    return undefined;
  }

  return headers
    .find(
      (header): header is string =>
        typeof header === "string" && header.startsWith(`${name}=`),
    )
    ?.split(";")[0];
}

async function createLoggedInUser(prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.com`;
  const password = "A-Strong-Test-Password-123!";

  emailsToClean.push(email);

  const registration = await request(app).post("/api/v1/auth/register").send({
    email,
    password,
    displayName: "Refresh Test",
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
  const refreshCookie = getCookiePair(headers, "refresh_token");

  expect(accessCookie).toBeDefined();
  expect(refreshCookie).toBeDefined();

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return {
    email,
    userId: user.id,
    accessCookie: accessCookie!,
    refreshCookie: refreshCookie!,
    rawRefreshToken: refreshCookie!.slice("refresh_token=".length),
  };
}

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

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token and issues a working access token", async () => {
    const loggedIn = await createLoggedInUser("refresh");

    const oldTokenHash = hashRefreshToken(loggedIn.rawRefreshToken);

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.refreshed).toBe(true);

    const setCookieHeader = response.headers["set-cookie"];
    const headers = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : setCookieHeader
        ? [setCookieHeader]
        : undefined;
    const newAccessCookie = getCookiePair(headers, "access_token");
    const newRefreshCookie = getCookiePair(headers, "refresh_token");

    expect(newAccessCookie).toBeDefined();
    expect(newRefreshCookie).toBeDefined();
    expect(newRefreshCookie).not.toBe(loggedIn.refreshCookie);

    const oldToken = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: oldTokenHash },
    });

    expect(oldToken.revokedAt).not.toBeNull();
    expect(oldToken.replacedBy).not.toBeNull();

    const newRawToken = newRefreshCookie!.slice("refresh_token=".length);

    const newToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(newRawToken) },
    });

    expect(newToken).not.toBeNull();
    expect(newToken!.revokedAt).toBeNull();

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", newAccessCookie!);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.userId).toBe(loggedIn.userId);
  });

  it("revokes the session when an already-rotated token is reused", async () => {
    const loggedIn = await createLoggedInUser("reuse");

    const firstRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(firstRefresh.status).toBe(200);

    const secondRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(secondRefresh.status).toBe(401);
    expect(secondRefresh.body.error.code).toBe("INVALID_REFRESH_TOKEN");

    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: loggedIn.userId },
    });

    expect(session.revokedAt).not.toBeNull();

    const sessionTokens = await prisma.refreshToken.findMany({
      where: { sessionId: session.id },
    });

    expect(sessionTokens.length).toBeGreaterThanOrEqual(2);
    expect(sessionTokens.every((token) => token.revokedAt !== null)).toBe(true);

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", loggedIn.accessCookie);

    expect(meResponse.status).toBe(401);
  });

  it("rejects a random refresh token", async () => {
    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", "refresh_token=not-a-real-token");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects a missing refresh token", async () => {
    const response = await request(app).post("/api/v1/auth/refresh");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects refresh tokens belonging to disabled accounts", async () => {
    const loggedIn = await createLoggedInUser("disabled-refresh");

    await prisma.user.update({
      where: { id: loggedIn.userId },
      data: { status: "DISABLED" },
    });

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");

    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: loggedIn.userId },
    });

    expect(session.revokedAt).not.toBeNull();
  });

  it("rejects an expired refresh token", async () => {
    const loggedIn = await createLoggedInUser("expired-refresh");

    await prisma.refreshToken.update({
      where: {
        tokenHash: hashRefreshToken(loggedIn.rawRefreshToken),
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });
  it("revokes the session when the same refresh token is used concurrently", async () => {
    const loggedIn = await createLoggedInUser("concurrent-refresh");

    const responses = await Promise.all([
      request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", loggedIn.refreshCookie),
      request(app)
        .post("/api/v1/auth/refresh")
        .set("Cookie", loggedIn.refreshCookie),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);

    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: loggedIn.userId },
      select: {
        revokedAt: true,
        refreshTokens: {
          select: { revokedAt: true },
        },
      },
    });

    expect(session.revokedAt).not.toBeNull();
    expect(
      session.refreshTokens.every((token) => token.revokedAt !== null),
    ).toBe(true);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the session, invalidates both tokens, and clears cookies", async () => {
    const loggedIn = await createLoggedInUser("logout");

    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", loggedIn.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.loggedOut).toBe(true);

    const setCookieHeader = response.headers["set-cookie"];
    const headers = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : setCookieHeader
        ? [setCookieHeader]
        : [];

    expect(headers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("access_token=;"),
        expect.stringContaining("refresh_token=;"),
      ]),
    );

    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: loggedIn.userId },
      include: { refreshTokens: true },
    });

    expect(session.revokedAt).not.toBeNull();
    expect(
      session.refreshTokens.every((token) => token.revokedAt !== null),
    ).toBe(true);

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", loggedIn.accessCookie);

    expect(meResponse.status).toBe(401);

    const refreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", loggedIn.refreshCookie);

    expect(refreshResponse.status).toBe(401);
  });

  it("rejects logout without authentication", async () => {
    const response = await request(app).post("/api/v1/auth/logout");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("POST /api/v1/auth/logout-all", () => {
  it("revokes all sessions belonging to the authenticated user", async () => {
    const firstLogin = await createLoggedInUser("logout-all");

    // Log in again to create a second session for the same user.
    const secondLogin = await request(app).post("/api/v1/auth/login").send({
      email: firstLogin.email,
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

    const response = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Cookie", firstLogin.accessCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      loggedOut: true,
      allSessionsRevoked: true,
    });

    const sessions = await prisma.authSession.findMany({
      where: { userId: firstLogin.userId },
      include: { refreshTokens: true },
    });

    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    for (const session of sessions) {
      expect(
        session.refreshTokens.every((token) => token.revokedAt !== null),
      ).toBe(true);
    }

    // Access tokens from both sessions must stop working.
    const firstMeResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", firstLogin.accessCookie);

    const secondMeResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", secondAccessCookie!);

    expect(firstMeResponse.status).toBe(401);
    expect(secondMeResponse.status).toBe(401);

    // Both sessions' refresh tokens must stop working.
    const firstRefreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstLogin.refreshCookie);

    const secondRefreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", secondRefreshCookie!);

    expect(firstRefreshResponse.status).toBe(401);
    expect(secondRefreshResponse.status).toBe(401);
  });

  it("does not revoke another user's sessions", async () => {
    const firstUser = await createLoggedInUser("logout-all-owner");
    const secondUser = await createLoggedInUser("logout-all-other");

    const response = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Cookie", firstUser.accessCookie);

    expect(response.status).toBe(200);

    const otherSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: secondUser.userId },
    });

    expect(otherSession.revokedAt).toBeNull();

    const otherMeResponse = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", secondUser.accessCookie);

    expect(otherMeResponse.status).toBe(200);

    const otherRefreshResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", secondUser.refreshCookie);

    expect(otherRefreshResponse.status).toBe(200);
  });

  it("rejects logout-all without authentication", async () => {
    const response = await request(app).post("/api/v1/auth/logout-all");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});
