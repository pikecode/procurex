import { fork } from 'node:child_process';
import { assertLoadIsolation, assertLoadApi } from './sustained-load.mjs';

export async function runOrderLoadGenerator(input, onProfile) {
  assertLoadIsolation(process.env); assertLoadApi(input.base);
  const child = fork(new URL('./order-load-generator.mjs', import.meta.url), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  return new Promise((resolve, reject) => {
    let result, failure;
    const timer = setTimeout(() => {
      failure = new Error('Isolated generator exceeded its deadline'); child.kill('SIGKILL');
    }, 150000);
    child.on('message', message => {
      if (message.type === 'profile') onProfile(message.profile);
      if (message.type === 'result') result = { ...message, pid: child.pid };
      if (message.type === 'failure') failure = new Error(message.message);
    });
    child.on('error', error => { failure = error; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0 || !result) reject(failure || new Error(`Generator closed without result: ${code}/${signal}`));
      else resolve(result);
    });
    child.send(input, error => { if (error) { failure = error; child.kill('SIGKILL'); } });
  });
}
