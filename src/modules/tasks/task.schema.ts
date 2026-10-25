import { z } from "zod";

export const createTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title is required.")
      .max(200, "Task title must be at most 200 characters."),

    description: z
      .string()
      .trim()
      .max(2000, "Description must be at most 2000 characters.")
      .nullable()
      .optional(),

    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),

    assigneeId: z.string().uuid().nullable().optional(),

    dueDate: z.iso.date().nullable().optional(),
  })
  .strict();

export const listTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigneeId: z.string().uuid().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
