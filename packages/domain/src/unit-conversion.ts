import { Decimal } from 'decimal.js';
import type { DecimalInput } from './money.js';

const ExactDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type PurchaseUnitConversion = {
  salesUnitId: string;
  purchaseUnitId: string;
  salesUnitsPerPurchaseUnit: string;
};

function positiveDecimal(value: DecimalInput, field: string, scale: number): Decimal {
  const decimal = new ExactDecimal(value);
  if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > scale) {
    throw new RangeError(`${field} must be positive with at most ${scale} decimal places`);
  }
  return decimal;
}

export function validatePurchaseUnitConversion(conversion: PurchaseUnitConversion): Decimal {
  if (!conversion.salesUnitId || !conversion.purchaseUnitId || conversion.salesUnitId === conversion.purchaseUnitId) {
    throw new RangeError('Purchase and sales units must be distinct');
  }
  const ratio = positiveDecimal(conversion.salesUnitsPerPurchaseUnit, 'Conversion ratio', 8);
  if (ratio.gte('1000000000000')) throw new RangeError('Conversion ratio exceeds storage precision');
  return ratio;
}

export function salesQuantityFromInput(
  quantity: DecimalInput,
  inputUnitId: string,
  salesUnitId: string,
  conversion?: PurchaseUnitConversion | null,
): Decimal {
  const input = positiveDecimal(quantity, 'Quantity', 6);
  let salesQuantity = input;
  if (!salesUnitId || inputUnitId !== salesUnitId) {
    if (!conversion || conversion.salesUnitId !== salesUnitId || conversion.purchaseUnitId !== inputUnitId) {
      throw new RangeError('Input unit is not configured for this product');
    }
    salesQuantity = input.mul(validatePurchaseUnitConversion(conversion));
  }
  // Reject loss of quantity rather than rounding before financial calculations.
  if (salesQuantity.decimalPlaces() > 6 || salesQuantity.gte('100000000000000')) {
    throw new RangeError('Converted quantity cannot be stored exactly');
  }
  return salesQuantity;
}

export function purchaseUnitPrice(salesUnitPrice: DecimalInput, conversion: PurchaseUnitConversion): Decimal {
  const price = new ExactDecimal(salesUnitPrice);
  if (!price.isFinite() || price.lt(0) || price.decimalPlaces() > 6 || price.gte('100000000000000')) {
    throw new RangeError('Sales unit price is invalid');
  }
  return price.mul(validatePurchaseUnitConversion(conversion));
}
