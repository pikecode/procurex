import net from 'node:net';

const defaultUrl = 'postgresql://procurex:procurex_local_only@127.0.0.1:55438/procurex?schema=public';
const databaseUrl = process.env.DATABASE_URL ?? defaultUrl;
const parsed = new URL(databaseUrl);
const host = parsed.hostname || '127.0.0.1';
const port = Number(parsed.port || 5432);

function checkPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(2500);
    socket.on('connect', () => {
      socket.end();
      resolve();
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Timed out connecting to ${host}:${port}`));
    });
    socket.on('error', reject);
  });
}

try {
  await checkPort();
  console.log(`Local database is reachable at ${host}:${port}.`);
} catch (error) {
  console.error(`Local database is not reachable at ${host}:${port}.`);
  console.error(`Reason: ${error.message}`);
  console.error('Start Docker Desktop or another PostgreSQL instance, then run: npm run db:up');
  process.exit(1);
}
