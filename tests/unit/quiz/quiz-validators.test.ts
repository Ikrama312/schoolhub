import { describe, expect, it } from 'vitest';
import {
  accommodationSchema,
  answerResponseSchema,
  manualGradeSchema,
  questionPatchSchema,
  questionSchema,
  quizPatchSchema,
  quizSettingsSchema,
  reorderSchema,
} from '@/lib/validators/quiz';

const settings = { title: 'Fractions', availableFrom: '2026-11-10T08:00:00Z', availableUntil: '2026-11-10T09:00:00Z' };
const sc = { type: 'SINGLE_CHOICE', prompt: 'Pick', points: 2, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: { optionId: 'a' } };

describe('quizSettingsSchema (FR-6)', () => {
  it('applies FR-1 defaults', () => {
    const r = quizSettingsSchema.parse(settings);
    expect(r).toMatchObject({ maxAttempts: 1, scoringPolicy: 'HIGHEST', resultsVisibility: 'AFTER_CLOSE', showCorrectAnswers: true, timeLimitMinutes: null, instructions: '' });
  });
  it('rejects availableUntil ≤ availableFrom', () => {
    expect(quizSettingsSchema.safeParse({ ...settings, availableUntil: settings.availableFrom }).success).toBe(false);
  });
  it('rejects a time limit longer than the window', () => {
    expect(quizSettingsSchema.safeParse({ ...settings, timeLimitMinutes: 60 }).success).toBe(true);
    expect(quizSettingsSchema.safeParse({ ...settings, timeLimitMinutes: 61 }).success).toBe(false);
  });
  it('enforces limits', () => {
    expect(quizSettingsSchema.safeParse({ ...settings, timeLimitMinutes: 0 }).success).toBe(false);
    expect(quizSettingsSchema.safeParse({ ...settings, maxAttempts: 11 }).success).toBe(false);
    expect(quizSettingsSchema.safeParse({ ...settings, title: ' ' }).success).toBe(false);
  });
  it('patch needs at least one key and only PUBLISHED/CLOSED status', () => {
    expect(quizPatchSchema.safeParse({}).success).toBe(false);
    expect(quizPatchSchema.safeParse({ status: 'DRAFT' }).success).toBe(false);
    expect(quizPatchSchema.parse({ status: 'PUBLISHED' })).toEqual({ status: 'PUBLISHED' });
  });
});

describe('questionSchema (FR-2)', () => {
  it('accepts a single choice and normalises points', () => {
    expect(questionSchema.parse(sc).points).toBe('2.00');
  });
  it('points 0.5–100 in 0.5 steps', () => {
    expect(questionSchema.safeParse({ ...sc, points: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sc, points: 0.5 }).success).toBe(true);
    expect(questionSchema.safeParse({ ...sc, points: 1.25 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sc, points: 100.5 }).success).toBe(false);
  });
  it('2–8 options and a correct answer among them', () => {
    expect(questionSchema.safeParse({ ...sc, options: [{ id: 'a', text: 'A' }] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sc, options: Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, text: 'x' })) }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sc, correct: { optionId: 'zz' } }).success).toBe(false);
  });
  it('multiple choice needs ≥ 1 correct', () => {
    expect(questionSchema.safeParse({ ...sc, type: 'MULTIPLE_CHOICE', correct: { optionIds: [] } }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sc, type: 'MULTIPLE_CHOICE', correct: { optionIds: ['a', 'b'] } }).success).toBe(true);
  });
  it('short answer 1–10 accepted; essay guidance optional; TF boolean', () => {
    const sa = { type: 'SHORT_ANSWER', prompt: 'p', points: 1, correct: { accepted: ['x'] } };
    expect(questionSchema.safeParse(sa).success).toBe(true);
    expect(questionSchema.safeParse({ ...sa, correct: { accepted: [] } }).success).toBe(false);
    expect(questionSchema.safeParse({ ...sa, correct: { accepted: Array(11).fill('x') } }).success).toBe(false);
    expect(questionSchema.safeParse({ type: 'ESSAY', prompt: 'p', points: 5, correct: {} }).success).toBe(true);
    expect(questionSchema.safeParse({ type: 'TRUE_FALSE', prompt: 'p', points: 1, correct: { value: 'yes' } }).success).toBe(false);
  });
  it('patch is strict and non-empty', () => {
    expect(questionPatchSchema.safeParse({}).success).toBe(false);
    expect(questionPatchSchema.safeParse({ order: 3 }).success).toBe(false);
    expect(questionPatchSchema.safeParse({ prompt: 'new' }).success).toBe(true);
  });
});

describe('answer / grade / accommodation / reorder', () => {
  it('answerResponseSchema accepts each shape and null; text ≤ 10,000', () => {
    for (const response of [{ optionId: 'a' }, { optionIds: ['a'] }, { value: false }, { text: 'hi' }, null]) {
      expect(answerResponseSchema.safeParse({ response }).success).toBe(true);
    }
    expect(answerResponseSchema.safeParse({ response: { text: 'x'.repeat(10_001) } }).success).toBe(false);
    expect(answerResponseSchema.safeParse({ response: { optionId: 'a', value: true } }).success).toBe(false);
  });
  it('manualGradeSchema uses pointsAwarded, ≥ 0, step 0.5', () => {
    expect(manualGradeSchema.parse({ pointsAwarded: 0 }).pointsAwarded).toBe('0.00');
    expect(manualGradeSchema.parse({ pointsAwarded: '3.5', feedback: 'ok' }).pointsAwarded).toBe('3.50');
    expect(manualGradeSchema.safeParse({ pointsAwarded: 0.3 }).success).toBe(false);
    expect(manualGradeSchema.safeParse({ points: 1 }).success).toBe(false);
    // Regression: non-numeric input is a validation error, never a thrown DecimalError.
    for (const bad of ['', 'abc', '-1', '1.']) expect(manualGradeSchema.safeParse({ pointsAwarded: bad }).success).toBe(false);
  });
  it('accommodationSchema limits', () => {
    expect(accommodationSchema.safeParse({ extraTimeMinutes: 300, extraAttempts: 5 }).success).toBe(true);
    expect(accommodationSchema.safeParse({ extraTimeMinutes: 301, extraAttempts: 0 }).success).toBe(false);
    expect(accommodationSchema.safeParse({ extraTimeMinutes: 0, extraAttempts: 6 }).success).toBe(false);
  });
  it('reorderSchema', () => {
    expect(reorderSchema.safeParse({ questionIds: [] }).success).toBe(false);
    expect(reorderSchema.safeParse({ questionIds: ['a', 'b'] }).success).toBe(true);
  });
});
