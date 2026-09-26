ALTER TABLE "DifferenceDisposalItem" DROP CONSTRAINT "DifferenceDisposalItem_creditItemId_fkey";
ALTER TABLE "DifferenceDisposalItem" ALTER COLUMN "creditItemId" DROP NOT NULL;
ALTER TABLE "DifferenceDisposalItem" ADD COLUMN "overpaymentId" UUID;
CREATE UNIQUE INDEX "DifferenceDisposalItem_overpaymentId_key" ON "DifferenceDisposalItem"("overpaymentId");
ALTER TABLE "DifferenceDisposalItem" ADD CONSTRAINT "DifferenceDisposalItem_creditItemId_fkey" FOREIGN KEY ("creditItemId") REFERENCES "DiscrepancyReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DifferenceDisposalItem" ADD CONSTRAINT "DifferenceDisposalItem_overpaymentId_fkey" FOREIGN KEY ("overpaymentId") REFERENCES "Overpayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
