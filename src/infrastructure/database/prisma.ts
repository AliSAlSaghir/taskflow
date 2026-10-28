import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  ...(env.NODE_ENV === "production"
    ? {
        ssl: {
          ca: readFileSync(
            new URL("../../../certs/ca.pem", import.meta.url),
            "utf8",
          ),
          rejectUnauthorized: true,
        },
      }
    : {}),
});

export const prisma = new PrismaClient({ adapter });
