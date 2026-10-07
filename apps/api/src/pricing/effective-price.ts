import type { Prisma } from '../../../../packages/backend/generated/prisma/client.js';

// A scheduled template price overrides shared prices only after its own effective time.
export async function effectivePriceVersion(client: Prisma.TransactionClient, productId: string, supplierId: string, at: Date, templateId?: string) {
  const read = (templateKey: string) => client.priceVersion.findFirst({
    where: { scope: { productId, supplierId, templateKey }, effectiveAt: { lte: at } },
    orderBy: [{ effectiveAt: 'desc' }, { revision: 'desc' }],
  });
  const supply = await read('');
  if (!supply) return null;
  const sale = (templateId ? await read(templateId.toLowerCase()) : null) ?? supply;
  // Scope identity is already fixed by the query; avoid fetching it again for each version.
  return { ...sale, scope: { id: sale.scopeId, productId: productId.toLowerCase(), supplierId: supplierId.toLowerCase(),
    templateKey: sale === supply ? '' : templateId!.toLowerCase() }, supplyPrice: supply.supplyPrice, supplyVersionId: supply.id };
}
