import { z } from "zod";

export const listAdminUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().min(1).max(254).optional(),
  })
  .strict();

export const adminUserIdSchema = z.string().uuid();

export const listAdminProjectsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().min(1).max(120).optional(),
    archived: z
      .enum(["true", "false"])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === "true",
      ),
  })
  .strict();

export const adminProjectIdSchema = z.string().uuid();

export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type ListAdminProjectsQuery = z.infer<
  typeof listAdminProjectsQuerySchema
>;
