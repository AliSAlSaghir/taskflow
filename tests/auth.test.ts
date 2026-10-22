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
