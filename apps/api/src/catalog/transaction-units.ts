import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';
import { purchaseUnitPrice, salesQuantityFromInput } from '../../../../packages/domain/src/unit-conversion.js';

export type TransactionUnitSnapshot = {
  templateId?: string;
  templateVersion?: number;
  minOrderQty?: string;
  orderMultiple?: string;
  salesUnitId: string;
  salesUnitName: string;
  purchaseUnitId: string | null;
  purchaseUnitName: string | null;
  salesUnitsPerPurchaseUnit: string | null;
  inputUnitId: string;
  inputQuantity: string;
  productVersion: number;
};

export async function readTransactionUnits(client: Prisma.TransactionClient, productId: string, quantity: string, unitId?: string, expectedProductVersion?: number, templateId?: string) {
  const product = await client.product.findUnique({ where: { id: productId }, include: { baseUnit: true, conversion: true } });
  if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product was not found' });
  if (expectedProductVersion !== undefined && product.updatedAt.getTime() !== expectedProductVersion) throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Product configuration changed; reload the catalog' });
  const conversion = product.conversion;
  const purchaseUnit = conversion ? await client.unit.findUnique({ where: { id: conversion.fromUnitId } }) : null;
  if (conversion && (!purchaseUnit || conversion.toUnitId !== product.baseUnitId)) {
    throw new ConflictException({ code: 'UNIT_CONVERSION_INVALID', message: 'Product conversion units are invalid' });
  }
  const configured = conversion ? { salesUnitId: product.baseUnitId, purchaseUnitId: conversion.fromUnitId, salesUnitsPerPurchaseUnit: conversion.ratio.toString() } : null;
  let salesQuantity: Decimal;
  try {
    salesQuantity = salesQuantityFromInput(quantity, unitId ?? product.baseUnitId, product.baseUnitId, configured);
  } catch (error) {
    throw new ConflictException({ code: 'UNIT_CONVERSION_INVALID', message: error instanceof Error ? error.message : 'Invalid quantity conversion' });
  }
  const templateItem = templateId ? await client.templateItem.findUnique({ where: { templateId_productId: { templateId, productId } }, include: { template: true } }) : null;
  if (templateId && (!templateItem || !templateItem.isEnabled || templateItem.template.isArchived)) throw new ConflictException({ code: 'PRODUCT_NOT_IN_CATALOG', message: 'Template product is not enabled' });
  const minOrderQty = (templateItem?.minOrderQty ?? product.minOrderQty).toString();
  const orderMultiple = (templateItem?.orderMultiple ?? product.orderMultiple).toString();
  if (salesQuantity.lt(minOrderQty) || !salesQuantity.mod(orderMultiple).isZero()) {
    throw new ConflictException({ code: 'INVALID_ITEM_QUANTITY', message: 'Sales quantity must satisfy minimum quantity and order multiple' });
  }
  const unitSnapshot: TransactionUnitSnapshot = {
    ...(templateItem ? { templateId, templateVersion: templateItem.template.updatedAt.getTime(), minOrderQty, orderMultiple } : {}),
    salesUnitId: product.baseUnitId, salesUnitName: product.baseUnit.name,
    purchaseUnitId: purchaseUnit?.id ?? null, purchaseUnitName: purchaseUnit?.name ?? null,
    salesUnitsPerPurchaseUnit: conversion?.ratio.toString() ?? null,
    inputUnitId: unitId ?? product.baseUnitId, inputQuantity: new Decimal(quantity).toString(),
    productVersion: product.updatedAt.getTime(),
  };
  return { quantity: salesQuantity.toString(), unitSnapshot };
}

export async function requireTransactionUnitsUnchanged(client: Prisma.TransactionClient, productId: string, snapshot: TransactionUnitSnapshot) {
  const current = await readTransactionUnits(client, productId, snapshot.inputQuantity, snapshot.inputUnitId, undefined, snapshot.templateId);
  if ((Object.keys(current.unitSnapshot) as Array<keyof TransactionUnitSnapshot>).some(key => current.unitSnapshot[key] !== snapshot[key])) {
    throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Product units changed; preview the request again' });
  }
}

export function readUnitSnapshot(snapshot: Prisma.JsonValue | null | undefined): TransactionUnitSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || typeof snapshot.salesUnitId !== 'string' || typeof snapshot.salesUnitName !== 'string') {
    return null;
  }
  return snapshot as unknown as TransactionUnitSnapshot;
}

export async function readUnitDisplayNames(client: Prisma.TransactionClient, snapshots: Array<Prisma.JsonValue | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(snapshots.flatMap(snapshot => {
    const unit = readUnitSnapshot(snapshot);
    return unit ? [unit.salesUnitId, ...(unit.purchaseUnitId ? [unit.purchaseUnitId] : [])] : [];
  }))];
  if (!ids.length) return new Map();
  const units = await client.unit.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(units.map(unit => [unit.id, unit.name]));
}

export function displaySalesUnitName(snapshot: Prisma.JsonValue | null | undefined, names: ReadonlyMap<string, string>): string | null {
  const unit = readUnitSnapshot(snapshot);
  // Resolve the original unit ID, never the product's subsequently changed base unit.
  return unit ? names.get(unit.salesUnitId) ?? unit.salesUnitName : null;
}

export function transactionUnitView(snapshot: Prisma.JsonValue | null | undefined, salesPrice: string, supplyPrice: string, names: ReadonlyMap<string, string> = new Map()) {
  const unit = readUnitSnapshot(snapshot);
  if (!unit) return { unitSnapshot: null, unitName: null, purchaseUnitName: null, unitBasis: 'LEGACY_UNKNOWN' as const, purchaseSalesUnitPrice: null, purchaseSupplyUnitPrice: null };
  const conversion = unit.purchaseUnitId && unit.salesUnitsPerPurchaseUnit
    ? { salesUnitId: unit.salesUnitId, purchaseUnitId: unit.purchaseUnitId, salesUnitsPerPurchaseUnit: unit.salesUnitsPerPurchaseUnit } : null;
  return { unitSnapshot: unit, unitName: displaySalesUnitName(snapshot, names), purchaseUnitName: unit.purchaseUnitId ? names.get(unit.purchaseUnitId) ?? unit.purchaseUnitName : null, unitBasis: 'TRANSACTION_SNAPSHOT' as const,
    purchaseSalesUnitPrice: conversion ? purchaseUnitPrice(salesPrice, conversion).toString() : null,
    purchaseSupplyUnitPrice: conversion ? purchaseUnitPrice(supplyPrice, conversion).toString() : null };
}
