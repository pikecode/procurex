import { Decimal } from 'decimal.js';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

export type DecimalInput = Decimal.Value;

export function toMoney(value: DecimalInput): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function toQuantity(value: DecimalInput): Decimal {
  return new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

export function lineAmount(quantity: DecimalInput, unitPrice: DecimalInput): Decimal {
  return toMoney(new Decimal(quantity).mul(unitPrice));
}

export function spreadProfit(salesGoodsAmount: DecimalInput, supplyGoodsAmount: DecimalInput): Decimal {
  return toMoney(new Decimal(salesGoodsAmount).minus(supplyGoodsAmount));
}

export function assertPositive(value: DecimalInput, fieldName: string): void {
  if (new Decimal(value).lte(0)) {
    throw new RangeError(`${fieldName} must be greater than 0`);
  }
}
