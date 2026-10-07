export function sharedFixtureUnit(database, name, code) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('procurex.catalog-registry'))`;
    const existing = await tx.unit.findFirst({ where: { name }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return existing || tx.unit.create({ data: { name, code } });
  });
}
