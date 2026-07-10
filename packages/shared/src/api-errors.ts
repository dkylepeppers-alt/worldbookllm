import { z } from 'zod';

export const apiErrorIssueSchema = z.strictObject({
  code: z.string().min(1),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string().min(1),
});

export const apiErrorSchema = z.strictObject({
  error: z.string().min(1),
  message: z.string().min(1),
  issues: z.array(apiErrorIssueSchema).optional(),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;
export type ApiErrorIssue = z.infer<typeof apiErrorIssueSchema>;
