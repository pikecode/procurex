export function assertLocalFixtureDatabase(connectionString, environment = process.env.NODE_ENV) {
  const refuse = () => { throw new Error('LOCAL_FIXTURE_DATABASE_REQUIRED: demo/acceptance seeds refuse production, remote or unrecognized databases'); };
  if (environment === 'production') refuse();
  let url;
  try { url = new URL(connectionString); } catch { refuse(); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !['/procurex', '/drill_source', '/drill_restore'].includes(url.pathname)
      || !url.port) refuse();
}
