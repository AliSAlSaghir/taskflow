import { prisma } from "../../infrastructure/database/prisma.js";
import {
  REFRESH_TOKEN_LIFETIME_MS,
  SESSION_LIFETIME_MS,
} from "./auth.constants.js";
import {
  createRefreshToken,
  hashRefreshToken,
} from "./refresh-token.service.js";

export async function createAuthSession(userId: string) {
  const now = new Date();

  const sessionExpiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);

  const refreshTokenExpiresAt = new Date(
    Math.min(
      now.getTime() + REFRESH_TOKEN_LIFETIME_MS,
      sessionExpiresAt.getTime(),
    ),
  );

  const refreshToken = createRefreshToken();

  const session = await prisma.authSession.create({
    data: {
      userId,
      expiresAt: sessionExpiresAt,
      refreshTokens: {
        create: {
          tokenHash: hashRefreshToken(refreshToken),
          expiresAt: refreshTokenExpiresAt,
        },
      },
    },
    select: {
      id: true,
    },
  });

  return {
    sessionId: session.id,
    refreshToken,
  };
}
