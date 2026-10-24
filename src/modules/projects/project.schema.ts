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

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const projectIdSchema = z.string().uuid();

export const updateProjectSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Project name is required.")
      .max(120, "Project name must be at most 120 characters.")
      .optional(),

    description: z
      .string()
      .trim()
      .max(2000, "Description must be at most 2000 characters.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "At least one field must be provided.",
  });

export const addProjectMemberSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("A valid email address is required.")
      .max(254, "Email must be at most 254 characters.")
      .transform((email) => email.toLowerCase()),
  })
  .strict();

export const listProjectMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type ListProjectMembersQuery = z.infer<
  typeof listProjectMembersQuerySchema
>;
