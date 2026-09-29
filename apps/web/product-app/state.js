import { loadJson } from './api.js';

export const state = {
  seed: null,
  run: null,
  readiness: null,
  tokens: {},
};

async function optionalJson(path) {
  try {
    return await loadJson(path);
  } catch {
    return null;
  }
}

export async function loadSeedState() {
  const [seed, run, readiness] = await Promise.all([
    loadJson('/main-flow-demo-seed.json'),
    loadJson('/main-flow-demo-run.json'),
    optionalJson('/m6-readiness.json'),
  ]);
  state.seed = seed;
  state.run = run;
  state.readiness = readiness;
  return state;
}
