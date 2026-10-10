import { ConflictException } from '@nestjs/common';

export function supplierSettlementCycle(mode: string, cycle?: string): string {
  if (mode !== 'SUPPLIER_TERM' && mode !== 'COMPANY_TERM') return 'IMMEDIATE';
  if (!cycle || !['IMMEDIATE', 'WEEKLY', 'HALF_MONTHLY', 'MONTHLY'].includes(cycle)) {
    throw new ConflictException({ code: 'SETTLEMENT_CYCLE_REQUIRED', message: '账期结算必须选择有效的结算周期' });
  }
  return cycle;
}
