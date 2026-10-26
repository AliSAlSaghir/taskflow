import { z } from "zod";

export const createLabelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Label name is required.")
      .max(50, "Label name must be at most 50 characters."),
  })
  .strict();

export const projectLabelParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const labelParamsSchema = projectLabelParamsSchema.extend({
  labelId: z.string().uuid(),
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;
