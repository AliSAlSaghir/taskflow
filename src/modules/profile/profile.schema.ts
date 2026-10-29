import { z } from "zod";

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, "Display name must be at least 2 characters.")
      .max(80, "Display name must be at most 80 characters.")
      .optional(),

    bio: z
      .string()
      .trim()
      .max(500, "Bio must be at most 500 characters.")
      .nullable()
      .optional(),
  })
  .refine((data) => data.displayName !== undefined || data.bio !== undefined, {
    message: "Provide at least one profile field to update.",
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
