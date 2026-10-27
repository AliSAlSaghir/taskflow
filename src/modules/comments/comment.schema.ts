import { z } from "zod";

export const createCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty.")
      .max(5000, "Comment must be at most 5000 characters."),
  })
  .strict();

export const updateCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Comment cannot be empty.")
      .max(5000, "Comment must be at most 5000 characters."),
  })
  .strict();

export const listCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
