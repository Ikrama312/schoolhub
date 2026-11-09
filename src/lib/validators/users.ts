import { z } from 'zod';

/**
 * Single source of truth for user/profile validation (FR-10, FR-19, FR-20).
 * Reused as: the React Hook Form resolver for the create/edit Stepper, the
 * CSV row validator for the import preview grid (client), and the
 * server-side re-validator in /api/users/import (never trusts the client).
 */

export const PHONE_REGEX = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRICT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function emptyToUndefined(value: unknown) {
  return value === '' || value === null ? undefined : value;
}

export const phoneSchema = z.string().regex(PHONE_REGEX, 'Phone must look like +1 555-123-4567');
export const optionalPhoneSchema = z.preprocess(emptyToUndefined, phoneSchema.optional());

export const requiredEmailSchema = z.string().regex(EMAIL_REGEX, 'Invalid email address');
export const optionalEmailSchema = z.preprocess(emptyToUndefined, requiredEmailSchema.optional());

/** Parses a strict YYYY-MM-DD string (CSV / date-only API input) into a Date. */
export function strictDateSchema(label: string) {
  return z
    .string()
    .regex(STRICT_DATE_REGEX, `${label} must be in YYYY-MM-DD format`)
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} is not a valid date`)
    .transform((value) => new Date(`${value}T00:00:00.000Z`));
}

export function calculateAgeYears(dateOfBirth: Date, asOf: Date = new Date()): number {
  let age = asOf.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** FR-10: a student's date of birth must make them between 3 and 21 years old. */
export function isValidStudentAge(dateOfBirth: Date): boolean {
  const age = calculateAgeYears(dateOfBirth);
  return age >= 3 && age <= 21;
}

export const GENDER_VALUES = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED'] as const;
export const GUARDIAN_RELATIONSHIP_VALUES = ['MOTHER', 'FATHER', 'GUARDIAN', 'GRANDPARENT', 'OTHER'] as const;
export const ROLE_VALUES = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as const;

const studentDobSchema = z.coerce
  .date()
  .refine(isValidStudentAge, { message: 'Student must be between 3 and 21 years old' });

// ---- Form / API body schemas (role-specific profile shapes) ----

export const studentProfileSchema = z.object({
  dateOfBirth: studentDobSchema,
  gender: z.enum(GENDER_VALUES).default('UNDISCLOSED'),
  gradeLevelId: z.string().min(1, 'Grade level is required'),
  enrollmentDate: z.coerce.date().default(() => new Date()),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  medicalNotes: z.string().optional(),
  emergencyContact: z.string().optional(),
  emergencyPhone: optionalPhoneSchema,
});
export type StudentProfileInput = z.infer<typeof studentProfileSchema>;

export const teacherProfileSchema = z.object({
  title: z.string().optional(),
  qualifications: z.string().optional(),
  hireDate: z.coerce.date().optional(),
});
export type TeacherProfileInput = z.infer<typeof teacherProfileSchema>;

export const parentProfileSchema = z.object({
  occupation: z.string().optional(),
  address: z.string().optional(),
});
export type ParentProfileInput = z.infer<typeof parentProfileSchema>;

export const userLinkInputSchema = z.object({
  linkedUserId: z.string().min(1),
  relationship: z.enum(GUARDIAN_RELATIONSHIP_VALUES),
  isPrimary: z.boolean().default(false),
});
export type UserLinkInput = z.infer<typeof userLinkInputSchema>;

export const createUserSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: requiredEmailSchema,
  phone: optionalPhoneSchema,
  role: z.enum(ROLE_VALUES),
  profile: z.union([studentProfileSchema, teacherProfileSchema, parentProfileSchema]).optional(),
  links: z.array(userLinkInputSchema).optional(),
  sendInvite: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: requiredEmailSchema.optional(),
  phone: optionalPhoneSchema,
  profile: z
    .object({
      dateOfBirth: z.coerce.date().refine(isValidStudentAge, {
        message: 'Student must be between 3 and 21 years old',
      }).optional(),
      gender: z.enum(GENDER_VALUES).optional(),
      gradeLevelId: z.string().min(1).optional(),
      enrollmentDate: z.coerce.date().optional(),
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      medicalNotes: z.string().optional(),
      emergencyContact: z.string().optional(),
      emergencyPhone: optionalPhoneSchema,
      title: z.string().optional(),
      qualifications: z.string().optional(),
      hireDate: z.coerce.date().optional(),
      occupation: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const meProfileSchema = z.object({
  phone: optionalPhoneSchema,
  occupation: z.string().optional(),
  address: z.string().optional(),
});
export type MeProfileInput = z.infer<typeof meProfileSchema>;

// ---- CSV row schemas (component 8/9) ----
// Raw papaparse string fields; dates are strict YYYY-MM-DD only (FR-21).

export const studentCsvRowSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: requiredEmailSchema,
  admission_number: z.string().min(1, 'Admission number is required'),
  date_of_birth: strictDateSchema('Date of birth').refine(isValidStudentAge, {
    message: 'Student must be between 3 and 21 years old',
  }),
  gender: z.string().optional(),
  grade_level: z.string().min(1, 'Grade level is required'),
  enrollment_date: strictDateSchema('Enrollment date'),
  parent1_first_name: z.string().optional(),
  parent1_last_name: z.string().optional(),
  parent1_email: optionalEmailSchema,
  parent1_phone: optionalPhoneSchema,
  parent1_relationship: z.string().optional(),
  parent2_first_name: z.string().optional(),
  parent2_last_name: z.string().optional(),
  parent2_email: optionalEmailSchema,
  parent2_phone: optionalPhoneSchema,
  parent2_relationship: z.string().optional(),
});
export type StudentCsvRow = z.infer<typeof studentCsvRowSchema>;

export const teacherCsvRowSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: requiredEmailSchema,
  employee_number: z.string().min(1, 'Employee number is required'),
  title: z.string().optional(),
  phone: optionalPhoneSchema,
});
export type TeacherCsvRow = z.infer<typeof teacherCsvRowSchema>;
