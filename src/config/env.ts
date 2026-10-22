import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.url().startsWith("postgresql://"),

    ACCESS_TOKEN_SECRET: z.string().min(43),

    DATABASE_URL_TEST: z.url().startsWith("postgresql://").optional(),

    ALLOW_DEMO_SEED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "test" && !data.DATABASE_URL_TEST) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL_TEST"],
        message: "DATABASE_URL_TEST is required when NODE_ENV=test.",
      });
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  console.error(z.treeifyError(result.error));
  throw new Error("Environment configuration validation failed");
}

const config = result.data;

export const env = {
  ...config,
  DATABASE_URL:
    config.NODE_ENV === "test"
      ? config.DATABASE_URL_TEST!
      : config.DATABASE_URL,
};
