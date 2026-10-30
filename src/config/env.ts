import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DATABASE_URL: z.url().startsWith("postgresql://"),

    FRONTEND_ORIGIN: z
      .url()
      .refine((value) => {
        const url = new URL(value);

        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.origin === value &&
          !url.username &&
          !url.password
        );
      }, "FRONTEND_ORIGIN must be an origin without a path, query, or fragment.")
      .optional(),

    B2_KEY_ID: z.string().min(1).optional(),
    B2_APPLICATION_KEY: z.string().min(1).optional(),
    B2_BUCKET_NAME: z.string().min(1).optional(),
    B2_REGION: z.string().min(1).optional(),
    B2_ENDPOINT: z.url().optional(),

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

    if (data.NODE_ENV === "production") {
      const storageFields = [
        "B2_KEY_ID",
        "B2_APPLICATION_KEY",
        "B2_BUCKET_NAME",
        "B2_REGION",
        "B2_ENDPOINT",
      ] as const;

      for (const field of storageFields) {
        if (!data[field]) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required in production.`,
          });
        }
      }
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
