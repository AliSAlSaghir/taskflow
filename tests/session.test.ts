import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/infrastructure/database/prisma.js";
import {
  REFRESH_TOKEN_LIFETIME_MS,
  SESSION_LIFETIME_MS,
} from "../src/modules/auth/auth.constants.js";
import { createAuthSession } from "../src/modules/auth/session.service.js";
import { hashRefreshToken } from "../src/modules/auth/refresh-token.service.js";

const createdUserIds: string[] = [];

afterEach(async () => {
  for (const userId of createdUserIds) {
    const sessions = await prisma.authSession.findMany({
      where: { userId },
      select: { id: true },
    });

    const sessionIds = sessions.map((session) => session.id);

    await prisma.refreshToken.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });

    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }

  createdUserIds.length = 0;
});

async function createTestUser() {
  const user = await prisma.user.create({
    data: {
      email: `session-${crypto.randomUUID()}@taskflow.test`,
      passwordHash: "not-a-real-password-hash",
    },
    select: { id: true },
  });

  createdUserIds.push(user.id);
  return user;
}

describe("createAuthSession", () => {
  it("creates a session and stores only the refresh-token hash", async () => {
    const user = await createTestUser();

    const result = await createAuthSession(user.id);

    const session = await prisma.authSession.findUnique({
      where: { id: result.sessionId },
      include: { refreshTokens: true },
    });

    expect(session).not.toBeNull();
    expect(session!.userId).toBe(user.id);
    expect(session!.refreshTokens).toHaveLength(1);

    const storedToken = session!.refreshTokens[0]!;

    expect(storedToken.tokenHash).toBe(hashRefreshToken(result.refreshToken));
    expect(storedToken.tokenHash).not.toBe(result.refreshToken);
  });

  it("sets the expected session and refresh-token lifetimes", async () => {
    const user = await createTestUser();
    const beforeCreation = Date.now();

    const result = await createAuthSession(user.id);

    const session = await prisma.authSession.findUnique({
      where: { id: result.sessionId },
      include: { refreshTokens: true },
    });

    const afterCreation = Date.now();

    expect(session).not.toBeNull();

    const refreshToken = session!.refreshTokens[0]!;

    expect(session!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeCreation + SESSION_LIFETIME_MS,
    );
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual(
      afterCreation + SESSION_LIFETIME_MS,
    );

    expect(refreshToken.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeCreation + REFRESH_TOKEN_LIFETIME_MS,
    );
    expect(refreshToken.expiresAt.getTime()).toBeLessThanOrEqual(
      afterCreation + REFRESH_TOKEN_LIFETIME_MS,
    );
  });
});
