/**
 * Builds the extension into extension/dist.
 *   npm run ext:build                 production build
 *   npm run ext:build -- --dev        development build (unminified, auto-reload on rebuild)
 *   npm run ext:build -- --dev --watch  rebuild on every change; the loaded extension reloads itself
 * build-id.txt is written last, after both passes, so a reloading extension never sees a half-written dist.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { extConfig, OUT_DIR } from '../vite.config';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
if (watch && !dev) console.warn('[oneof-ext] --watch without --dev: the loaded extension will not auto-reload.');

let idTimer: ReturnType<typeof setTimeout> | undefined;
const writeBuildId = () => {
  clearTimeout(idTimer);
  idTimer = setTimeout(() => {
    const id = `${Date.now().toString(36)}-${dev ? 'dev' : 'prod'}`;
    writeFileSync(resolve(OUT_DIR, 'build-id.txt'), `${id}\n`);
    console.log(`[oneof-ext] ${dev ? 'dev' : 'production'} build ready: ${OUT_DIR} (build ${id})`);
  }, watch ? 300 : 0);
};

async function pass(p: 'app' | 'content') {
  const cfg = extConfig(p, dev);
  const out = await build({
    ...cfg,
    configFile: false,
    mode: dev ? 'development' : 'production',
    build: { ...cfg.build, ...(watch ? { watch: {}, emptyOutDir: false } : {}) },
  });
  if (watch) {
    const w = out as unknown as { on(ev: 'event', cb: (e: { code: string; error?: unknown }) => void): void };
    w.on('event', (e) => { if (e.code === 'END') writeBuildId(); if (e.code === 'ERROR') console.error(e.error); });
  }
}

// In watch mode each pass rebuilds on its own, so neither may empty the folder: clean once here.
if (watch) rmSync(OUT_DIR, { recursive: true, force: true });
await pass('app');
await pass('content');
if (!watch) writeBuildId();
