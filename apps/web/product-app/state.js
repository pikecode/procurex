import { loadJson } from './api.js';

export const state = {
  seed: null,
  run: null,
  tokens: {},
};

export async function loadSeedState() {
  const [seed, run] = await Promise.all([
    loadJson('/main-flow-demo-seed.json'),
    loadJson('/main-flow-demo-run.json'),
  ]);
  state.seed = seed;
  state.run = run;
  return state;
}
