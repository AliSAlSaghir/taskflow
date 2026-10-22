import argon2 from "argon2";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";
import { EmailAlreadyRegisteredError } from "./auth.errors.js";

export async function registerUser(input: RegisterInput) {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        profile: {
          create: {
            displayName: input.displayName,
          },
        },
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            bio: true,
            profilePictureKey: true,
          },
        },
      },
    });

    return user;
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new EmailAlreadyRegisteredError();
    }

    throw error;
  }
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: input.email,
        mode: "insensitive",
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      status: true,
      createdAt: true,
      profile: {
        select: {
          displayName: true,
          bio: true,
          profilePictureKey: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const passwordIsValid = await argon2.verify(
    user.passwordHash,
    input.password,
  );

  if (!passwordIsValid) {
    return null;
  }

  const { passwordHash: _passwordHash, ...safeUser } = user;

  return safeUser;
}
