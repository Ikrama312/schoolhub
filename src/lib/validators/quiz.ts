import { z } from 'zod';
import { dec, fixed2 } from '@/server/assignments/grading-math';

/**
 * PRD-10 validation (FR-2, FR-6, system-design §3.2). Client-safe: shared by the builder forms and
 * every quiz route handler. Decimals come in as number | string and leave as "2.50" (fixed2).
 * No schema carries a client "now" (ADR-4): open/closed and deadline rules live in the services.
 */

export const QUESTION_TYPES = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY'] as const;
export const RESULTS_VISIBILITIES = ['IMMEDIATELY', 'AFTER_CLOSE', 'MANUAL'] as const;
export const SCORING_POLICIES = ['HIGHEST', 'LATEST', 'AVERAGE'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const TITLE_MAX = 150;
export const INSTRUCTIONS_MAX = 50_000;
export const PROMPT_MAX = 20_000;
export const ANSWER_TEXT_MAX = 10_000;
export const FEEDBACK_MAX = 10_000;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: 'Single choice',
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True / false',
  SHORT_ANSWER: 'Short answer',
  ESSAY: 'Essay',
};

/** number | "2.5" within [min, max] in steps of 0.5 → "2.50". */
const halfStep = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string().trim().min(1, `${label} is required`)])
    // One superRefine that stops at the first failure: zod runs chained refines even after one
    // fails, and dec() throws on a non-numeric string.
    .superRefine((v, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (!/^\d+(\.\d{1,2})?$/.test(String(v))) return fail(`${label} must be a number`);
      if (!dec(v).mul(2).isInteger()) return fail(`${label} must be a multiple of 0.5`);
      if (dec(v).lt(min) || dec(v).gt(max)) return fail(`${label} must be between ${min} and ${max}`);
    })
    .transform((v) => fixed2(v));

const instant = z.coerce.date({ invalid_type_error: 'Enter a valid date and time' });

// ---------------------------------------------------------------------------
// Quiz settings (FR-6)
// ---------------------------------------------------------------------------

export const quizSettingsFields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX),
  instructions: z.string().max(INSTRUCTIONS_MAX).default(''),
  isPractice: z.boolean().default(false),
  availableFrom: instant,
  availableUntil: instant,
  timeLimitMinutes: z.coerce.number().int().min(1, 'At least 1 minute').max(300, 'At most 300 minutes').nullable().default(null),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(1),
  scoringPolicy: z.enum(SCORING_POLICIES).default('HIGHEST'),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  oneQuestionPerPage: z.boolean().default(false),
  resultsVisibility: z.enum(RESULTS_VISIBILITIES).default('AFTER_CLOSE'),
  showCorrectAnswers: z.boolean().default(true),
  /** PRD-11 FR-2: gradebook category; null = Uncategorised. */
  categoryId: z.string().min(1).nullable().optional(),
});

type WindowFields = { availableFrom?: Date; availableUntil?: Date; timeLimitMinutes?: number | null };

/** availableUntil > availableFrom; timeLimit ≤ window length in minutes (FR-6). */
export function checkWindow(v: WindowFields, ctx: z.RefinementCtx) {
  if (!v.availableFrom || !v.availableUntil) return;
  if (v.availableUntil <= v.availableFrom) {
    ctx.addIssue({ code: 'custom', path: ['availableUntil'], message: 'Must be after the opening time' });
    return;
  }
  const windowMinutes = (v.availableUntil.getTime() - v.availableFrom.getTime()) / 60_000;
  if (v.timeLimitMinutes != null && v.timeLimitMinutes > windowMinutes) {
    ctx.addIssue({ code: 'custom', path: ['timeLimitMinutes'], message: 'Time limit is longer than the availability window' });
  }
}

export const quizSettingsSchema = quizSettingsFields.superRefine(checkWindow);
export type QuizSettings = z.output<typeof quizSettingsSchema>;

/** POST /api/courses/:id/quizzes: title + window required, everything else defaults. */
export const quizCreateSchema = quizSettingsSchema;

/** PATCH /api/quizzes/:id. Cross-field rules re-run in the service on stored ⊕ patch. */
export const quizPatchSchema = quizSettingsFields
  .partial()
  .extend({ status: z.enum(['PUBLISHED', 'CLOSED']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type QuizPatch = z.output<typeof quizPatchSchema>;

// ---------------------------------------------------------------------------
// Questions (FR-2, FR-7)
// ---------------------------------------------------------------------------

export const optionSchema = z.object({ id: z.string().min(1), text: z.string().trim().min(1, 'Option text is required').max(1000) });
export type QuizOption = z.infer<typeof optionSchema>;

const options = z.array(optionSchema).min(2, 'Add at least 2 options').max(8, 'At most 8 options');
const common = {
  prompt: z.string().trim().min(1, 'Question text is required').max(PROMPT_MAX),
  points: halfStep(0.5, 100, 'Points'),
  explanation: z.string().max(PROMPT_MAX).nullable().default(null),
};

const questionUnion = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SINGLE_CHOICE'), ...common, options, correct: z.object({ optionId: z.string().min(1, 'Mark the correct option') }), caseSensitive: z.boolean().default(false) }),
  z.object({ type: z.literal('MULTIPLE_CHOICE'), ...common, options, correct: z.object({ optionIds: z.array(z.string().min(1)).min(1, 'Mark at least one correct option') }), caseSensitive: z.boolean().default(false) }),
  z.object({ type: z.literal('TRUE_FALSE'), ...common, options: z.null().optional(), correct: z.object({ value: z.boolean() }), caseSensitive: z.boolean().default(false) }),
  z.object({
    type: z.literal('SHORT_ANSWER'),
    ...common,
    options: z.null().optional(),
    correct: z.object({ accepted: z.array(z.string().trim().min(1, 'Accepted answer cannot be empty').max(500)).min(1, 'Add at least one accepted answer').max(10) }),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({ type: z.literal('ESSAY'), ...common, options: z.null().optional(), correct: z.object({ guidance: z.string().max(PROMPT_MAX).optional() }), caseSensitive: z.boolean().default(false) }),
]);

export const questionSchema = questionUnion.superRefine((q, ctx) => {
  if (q.type !== 'SINGLE_CHOICE' && q.type !== 'MULTIPLE_CHOICE') return;
  const ids = q.options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option ids must be unique' });
  const chosen = q.type === 'SINGLE_CHOICE' ? [q.correct.optionId] : q.correct.optionIds;
  if (chosen.some((id) => !ids.includes(id))) ctx.addIssue({ code: 'custom', path: ['correct'], message: 'Correct answer must be one of the options' });
});
export type QuestionInput = z.output<typeof questionSchema>;
export type CorrectValue = QuestionInput['correct'];

/** PATCH /api/questions/:id. The merged result is re-validated with questionSchema in the service. */
export const questionPatchSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string(),
    points: z.union([z.number(), z.string()]),
    options: z.array(optionSchema).nullable(),
    correct: z.record(z.unknown()),
    explanation: z.string().nullable(),
    caseSensitive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type QuestionPatch = z.output<typeof questionPatchSchema>;

export const reorderSchema = z.object({ questionIds: z.array(z.string().min(1)).min(1) });

// ---------------------------------------------------------------------------
// Attempts (FR-15, FR-24, FR-28)
// ---------------------------------------------------------------------------

/** Type-agnostic so the autosave hot path never loads the Question (NFR-2). */
export const responseSchema = z.union([
  z.object({ optionId: z.string().min(1) }).strict(),
  z.object({ optionIds: z.array(z.string().min(1)).max(8) }).strict(),
  z.object({ value: z.boolean() }).strict(),
  z.object({ text: z.string().max(ANSWER_TEXT_MAX, `At most ${ANSWER_TEXT_MAX} characters`) }).strict(),
]);
export type AnswerResponse = z.infer<typeof responseSchema>;

export const answerResponseSchema = z.object({ response: responseSchema.nullable() });

/** Field is `pointsAwarded` per api-contracts (not `points`). Upper bound checked in the service. */
export const manualGradeSchema = z.object({
  pointsAwarded: halfStep(0, 100, 'Points'),
  feedback: z.string().max(FEEDBACK_MAX).nullable().optional(),
});
export type ManualGradeInput = z.output<typeof manualGradeSchema>;

export const accommodationSchema = z.object({
  extraTimeMinutes: z.coerce.number().int().min(0).max(300),
  extraAttempts: z.coerce.number().int().min(0).max(5),
});
export type AccommodationInput = z.output<typeof accommodationSchema>;

export const analyticsQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
