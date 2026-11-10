import { z } from 'zod';

/** PRD-16 at-risk list + student insights params (api-contracts, NFR-6). */

export const RISK_LEVELS = ['HIGH', 'MEDIUM'] as const;
export const RISK_SIGNALS = ['ATTENDANCE', 'GRADES', 'MISSING'] as const;

const id = z.string().min(1);
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const atRiskQuery = z.object({
  level: optional(z.enum(RISK_LEVELS)),
  reason: optional(z.enum(RISK_SIGNALS)),
  gradeLevel: optional(id),
  sectionId: optional(id),
  page: z.coerce.number().int().min(1).catch(1),
  // pageSize > 100 is clamped, not rejected (api-contracts errorPolicy).
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .catch(20)
    .transform((n) => Math.min(n, 100)),
  format: z.enum(['json', 'csv']).default('json'),
});
export type AtRiskQuery = z.infer<typeof atRiskQuery>;
export type AtRiskFilters = Pick<AtRiskQuery, 'level' | 'reason' | 'gradeLevel' | 'sectionId'>;

export const studentInsightsParams = z.object({ id });
