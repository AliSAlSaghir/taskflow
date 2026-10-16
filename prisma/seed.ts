import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEMO_SEED !== "true"
) {
  throw new Error(
    "Demo seeding is disabled. Set ALLOW_DEMO_SEED=true in development.",
  );
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const demoUsers = [
    {
      email: "owner@taskflow.local",
      password: "TaskFlowOwnerDev123!",
      displayName: "Demo Owner",
    },
    {
      email: "member@taskflow.local",
      password: "TaskFlowMemberDev123!",
      displayName: "Demo Member",
    },
  ];

  for (const demoUser of demoUsers) {
    const passwordHash = await argon2.hash(demoUser.password, {
      type: argon2.argon2id,
    });

    await prisma.user.upsert({
      where: { email: demoUser.email },
      update: {
        passwordHash,
        status: "ACTIVE",
      },
      create: {
        email: demoUser.email,
        passwordHash,
        profile: {
          create: {
            displayName: demoUser.displayName,
          },
        },
      },
    });

    console.log(`Seeded user: ${demoUser.email}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Database seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
