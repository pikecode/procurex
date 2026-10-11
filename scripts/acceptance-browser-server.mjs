import { chromium } from 'playwright';

const server = await chromium.launchServer({
  executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
  host: '0.0.0.0', port: Number(process.env.PORT || 9335), wsPath: '/procurex-acceptance',
});
console.log(server.wsEndpoint());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await server.close(); process.exit(0);
});
