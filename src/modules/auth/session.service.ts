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
    select: { id: true },
  });

  return {
    sessionId: session.id,
    refreshToken,
  };
}

type RefreshResult =
  | {
      kind: "rotated";
      userId: string;
      sessionId: string;
      refreshToken: string;
    }
  | { kind: "invalid" }
  | { kind: "reused" };

export async function rotateRefreshToken(
  rawToken: string,
): Promise<RefreshResult> {
  const now = new Date();
  const oldTokenHash = hashRefreshToken(rawToken);
  const nextRawToken = createRefreshToken();
  const nextTokenHash = hashRefreshToken(nextRawToken);

  return prisma.$transaction(async (tx) => {
    const storedToken = await tx.refreshToken.findUnique({
      where: { tokenHash: oldTokenHash },
      include: {
        session: {
          include: {
            user: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!storedToken) {
      return { kind: "invalid" };
    }

    const { session } = storedToken;

    // A previously rotated token was presented again.
    if (storedToken.revokedAt !== null) {
      if (session.revokedAt === null) {
        await tx.authSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });

        await tx.refreshToken.updateMany({
          where: {
            sessionId: session.id,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      return { kind: "reused" };
    }

    if (
      storedToken.expiresAt <= now ||
      session.expiresAt <= now ||
      session.revokedAt !== null ||
      session.user.status !== "ACTIVE"
    ) {
      // A disabled account must not retain a usable session.
      if (session.user.status !== "ACTIVE" && session.revokedAt === null) {
        await tx.authSession.updateMany({
          where: {
            id: session.id,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });

        await tx.refreshToken.updateMany({
          where: {
            sessionId: session.id,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      return { kind: "invalid" };
    }

    const nextTokenExpiresAt = new Date(
      Math.min(
        now.getTime() + REFRESH_TOKEN_LIFETIME_MS,
        session.expiresAt.getTime(),
      ),
    );

    const nextStoredToken = await tx.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: nextTokenHash,
        expiresAt: nextTokenExpiresAt,
      },
      select: { id: true },
    });

    // Only one concurrent request can revoke this active token.
    const rotation = await tx.refreshToken.updateMany({
      where: {
        id: storedToken.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
        replacedBy: nextStoredToken.id,
      },
    });

    if (rotation.count !== 1) {
      // Another request may have rotated this token first.
      await tx.refreshToken.delete({
        where: { id: nextStoredToken.id },
      });

      await tx.authSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      await tx.refreshToken.updateMany({
        where: {
          sessionId: session.id,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      return { kind: "reused" };
    }

    return {
      kind: "rotated",
      userId: session.user.id,
      sessionId: session.id,
      refreshToken: nextRawToken,
    };
  });
}
