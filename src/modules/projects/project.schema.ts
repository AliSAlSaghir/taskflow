import { z } from "zod";

export const createProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Project name is required.")
      .max(120, "Project name must be at most 120 characters."),

    description: z
      .string()
      .trim()
      .max(2000, "Description must be at most 2000 characters.")
      .nullable()
      .optional(),
  })
  .strict();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
