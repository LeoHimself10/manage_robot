import { z } from "zod";

export const qualityDraftFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  currentSituation: z.string().trim().min(1).max(10000),
  occurredAt: z.string().trim().max(64).optional(),
  reporter: z.string().trim().max(100).optional(),
  reporterUserId: z.string().trim().max(200).optional(),
  deviceModel: z.string().trim().max(200).optional(),
  serialNo: z.string().trim().max(200).optional(),
  catheterBatch: z.string().trim().max(200).optional(),
  clinicianAware: z.string().trim().max(500).optional(),
  impact: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(200).optional(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  notes: z.string().trim().max(10000).optional(),
});

export const qualityDraftInputSchema = qualityDraftFieldsSchema.extend({
  expectedVersion: z.number().int().positive(),
  requestId: z.string().uuid(),
});

export const qualityDraftPatchSchema = qualityDraftFieldsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "draft patch is empty" },
);

export type QualityDraftFields = z.infer<typeof qualityDraftFieldsSchema>;
export type QualityDraftPatchInput = z.infer<typeof qualityDraftPatchSchema>;

