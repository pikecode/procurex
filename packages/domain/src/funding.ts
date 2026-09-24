import { Decimal } from 'decimal.js';
import { toMoney } from './money.js';

export interface StoredValueDecision {
  requestedAmount: Decimal;
  paidAmount: Decimal;
  shortfallAmount: Decimal;
  canConfirm: boolean;
}

export function evaluateStoredValueFunding(balance: Decimal.Value, requestedAmount: Decimal.Value): StoredValueDecision {
  const requested = toMoney(requestedAmount);
  const available = toMoney(balance);

  if (available.greaterThanOrEqualTo(requested)) {
    return {
      requestedAmount: requested,
      paidAmount: requested,
      shortfallAmount: toMoney(0),
      canConfirm: true,
    };
  }

  return {
    requestedAmount: requested,
    paidAmount: toMoney(0),
    shortfallAmount: toMoney(requested.minus(available)),
    canConfirm: false,
  };
}
