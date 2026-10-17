ALTER TABLE "Receipt"
  ADD COLUMN "exceptionStatus" VARCHAR(20),
  ADD COLUMN "exceptionResponse" VARCHAR(500),
  ADD COLUMN "exceptionDecision" VARCHAR(20),
  ADD COLUMN "exceptionResolution" VARCHAR(500);
