import { z } from "zod";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .max(254, "Email must be at most 254 characters.")
    .transform((email) => email.toLowerCase()),

  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(128, "Password must be at most 128 characters."),

  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters.")
    .max(80, "Display name must be at most 80 characters."),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter a valid email address.")
    .max(254, "Email must be at most 254 characters.")
    .transform((email) => email.toLowerCase()),

  password: z
    .string()
    .min(1, "Password is required.")
    .max(128, "Password must be at most 128 characters."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
