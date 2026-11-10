-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "StudentRiskSnapshot" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "level" "RiskLevel",
    "previousLevel" "RiskLevel",
    "reasons" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "highNotifiedAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentRiskSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentRiskSnapshot_termId_level_idx" ON "StudentRiskSnapshot"("termId", "level");

-- CreateIndex
CREATE INDEX "StudentRiskSnapshot_termId_computedAt_idx" ON "StudentRiskSnapshot"("termId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRiskSnapshot_studentId_termId_key" ON "StudentRiskSnapshot"("studentId", "termId");

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRiskSnapshot" ADD CONSTRAINT "StudentRiskSnapshot_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

