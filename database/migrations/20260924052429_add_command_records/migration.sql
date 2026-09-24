-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "CommandRecord" (
    "id" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PROCESSING',
    "resourceType" VARCHAR(80),
    "resourceId" UUID,
    "responseBody" JSONB,
    "errorBody" JSONB,
    "traceId" VARCHAR(80) NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CommandRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommandRecord_actorUserId_startedAt_idx" ON "CommandRecord"("actorUserId", "startedAt");

-- CreateIndex
CREATE INDEX "CommandRecord_status_expiresAt_idx" ON "CommandRecord"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommandRecord_actorUserId_action_idempotencyKey_key" ON "CommandRecord"("actorUserId", "action", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CommandRecord" ADD CONSTRAINT "CommandRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
