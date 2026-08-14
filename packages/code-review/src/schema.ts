import { z } from "zod";

export const reviewSchema = z.object({
  summary: z.string().describe("One-sentence verdict on the diff"),
  findings: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().positive(),
      severity: z.enum(["info", "warning", "error"]),
      message: z.string(),
    }),
  ),
});

export type Review = z.infer<typeof reviewSchema>;
