-- CreateEnum
CREATE TYPE "AbsenceNoteStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AbsenceReason" AS ENUM ('ILLNESS', 'MEDICAL_APPOINTMENT', 'FAMILY', 'RELIGIOUS', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentResponseValue" AS ENUM ('GRANTED', 'DECLINED');

-- CreateTable
CREATE TABLE "AbsenceNote" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "partialDay" BOOLEAN NOT NULL DEFAULT false,
    "periodIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" "AbsenceReason" NOT NULL,
    "details" TEXT,
    "fileId" TEXT,
    "status" "AbsenceNoteStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bookingOpensAt" TIMESTAMP(3) NOT NULL,
    "bookingClosesAt" TIMESTAMP(3) NOT NULL,
    "slotMinutes" INTEGER NOT NULL,
    "gradeLevelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceSlot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "bookedByParentId" TEXT,
    "bookedForStudentId" TEXT,
    "parentNote" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentForm" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT,
    "createdById" TEXT NOT NULL,
    "lastRemindedAt" TIMESTAMP(3),
    "dueReminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAudience" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "type" "AudienceType" NOT NULL,
    "refId" TEXT NOT NULL,

    CONSTRAINT "ConsentAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "respondedById" TEXT NOT NULL,
    "value" "ConsentResponseValue" NOT NULL,
    "signature" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceNote_studentId_status_fromDate_idx" ON "AbsenceNote"("studentId", "status", "fromDate");

-- CreateIndex
CREATE INDEX "AbsenceNote_status_createdAt_idx" ON "AbsenceNote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ConferenceEvent_date_idx" ON "ConferenceEvent"("date");

-- CreateIndex
CREATE INDEX "ConferenceSlot_bookedByParentId_idx" ON "ConferenceSlot"("bookedByParentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceSlot_eventId_teacherId_startsAt_key" ON "ConferenceSlot"("eventId", "teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "ConsentForm_dueAt_idx" ON "ConsentForm"("dueAt");

-- CreateIndex
CREATE INDEX "ConsentAudience_formId_idx" ON "ConsentAudience"("formId");

-- CreateIndex
CREATE INDEX "ConsentAudience_type_refId_idx" ON "ConsentAudience"("type", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentResponse_formId_studentId_key" ON "ConsentResponse"("formId", "studentId");

-- AddForeignKey
ALTER TABLE "AbsenceNote" ADD CONSTRAINT "AbsenceNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNote" ADD CONSTRAINT "AbsenceNote_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceNote" ADD CONSTRAINT "AbsenceNote_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceEvent" ADD CONSTRAINT "ConferenceEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceSlot" ADD CONSTRAINT "ConferenceSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ConferenceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceSlot" ADD CONSTRAINT "ConferenceSlot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceSlot" ADD CONSTRAINT "ConferenceSlot_bookedByParentId_fkey" FOREIGN KEY ("bookedByParentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceSlot" ADD CONSTRAINT "ConferenceSlot_bookedForStudentId_fkey" FOREIGN KEY ("bookedForStudentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentForm" ADD CONSTRAINT "ConsentForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentForm" ADD CONSTRAINT "ConsentForm_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAudience" ADD CONSTRAINT "ConsentAudience_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ConsentForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentResponse" ADD CONSTRAINT "ConsentResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "ConsentForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentResponse" ADD CONSTRAINT "ConsentResponse_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentResponse" ADD CONSTRAINT "ConsentResponse_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- FR-31 / ADR-4: one booked slot per teacher per child per event. Prisma can't express partial indexes.
CREATE UNIQUE INDEX "ConferenceSlot_one_per_teacher_per_child" ON "ConferenceSlot"("eventId", "teacherId", "bookedForStudentId") WHERE "bookedForStudentId" IS NOT NULL;
