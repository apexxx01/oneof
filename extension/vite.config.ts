/**
 * Vite config for the Chrome extension. Two passes (run by extension/scripts/build.ts):
 *   app:     side panel (React, ES modules) + service worker (module worker) + static files
 *   content: the content script as a single classic IIFE (MV3 content scripts can't be modules)
 * Everything is bundled locally: MV3 allows no remote code, and the panel's CSP blocks it anyway.
 */
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { demoFile } from './scripts/demo-file';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
export const OUT_DIR = resolve(here, 'dist');

// No cloud calls in the extension, so App Check is never initialised (see ARCHITECTURE.md).
// Pre-existing VITE_* variables win over .env files, so this holds even with a fork's .env.local.
process.env.VITE_APPCHECK = 'off';

export type Pass = 'app' | 'content';

export function extConfig(pass: Pass, dev: boolean): UserConfig {
  const common: UserConfig = {
    root: here,
    envDir: repo, // same .env.local overrides as the web app (Firebase config for forks)
    base: './',
    publicDir: false,
    logLevel: 'warn',
    define: { __ONEOF_DEV__: JSON.stringify(dev) },
    build: {
      outDir: OUT_DIR,
      minify: !dev,
      sourcemap: dev ? 'inline' : false,
      target: 'chrome138',
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500, // one local panel bundle; nothing is downloaded
      modulePreload: false,
    },
  };
  if (pass === 'content') {
    return {
      ...common,
      build: {
        ...common.build,
        emptyOutDir: false,
        rolldownOptions: {
          input: { content: resolve(here, 'src/content/index.ts') },
          output: { format: 'iife', entryFileNames: 'content.js' },
        },
      },
    };
  }
  return {
    ...common,
    plugins: [react(), appCheckCompiledOut(), extensionFiles(dev)],
    build: {
      ...common.build,
      emptyOutDir: true,
      rolldownOptions: {
        input: { sidepanel: resolve(here, 'sidepanel.html'), sw: resolve(here, 'src/background/sw.ts') },
        output: {
          format: 'es',
          entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
}

/**
 * src/lib/firebase.ts imports 'firebase/app-check' for the web app. In the extension that import
 * resolves to a stub (src/panel/app-check-off.ts): no cloud calls means no App Check, and the
 * reCAPTCHA loader (a remote script) never ships in the package. Only that one importer is redirected.
 */
function appCheckCompiledOut(): Plugin {
  const firebaseTs = resolve(repo, 'src/lib/firebase.ts');
  return {
    name: 'oneof-app-check-compiled-out',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'firebase/app-check' && importer && resolve(importer.split('?')[0]) === firebaseTs) return resolve(here, 'src/panel/app-check-off.ts');
      return null;
    },
  };
}

/** manifest.json, the trimmed synthetic demo history, and generated icons. */
function extensionFiles(dev: boolean): Plugin {
  return {
    name: 'oneof-extension-files',
    generateBundle() {
      const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));
      if (dev) manifest.name = `${manifest.name} (dev)`;
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'demo/p1-demo.json', source: JSON.stringify(demoFile()) });
      for (const s of [16, 32, 48, 128]) this.emitFile({ type: 'asset', fileName: `icons/icon${s}.png`, source: icon(s) });
    },
  };
}

/** A small PNG: the web app's orange logo tile with a dark ring. */
function icon(size: number): Uint8Array {
  const px = new Uint8Array(size * (size * 4 + 1));
  const c = (size - 1) / 2, r = size * 0.22;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.max(0, Math.abs(x - c) - (c - r)), dy = Math.max(0, Math.abs(y - c) - (c - r));
      const inTile = dx * dx + dy * dy <= r * r;
      const d = Math.hypot(x - c, y - c) / size;
      const ring = d > 0.17 && d < 0.29;
      const [R, G, B, A] = !inTile ? [0, 0, 0, 0] : ring ? [0x12, 0x06, 0x04, 255] : [0xff, 0x5b, 0x2e, 255];
      const o = y * (size * 4 + 1) + 1 + x * 4;
      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = A;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let k = n; for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; return k >>> 0; });
  const crc = (b: Uint8Array) => { let x = 0xffffffff; for (const v of b) x = crcTable[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

export default defineConfig(({ mode }) => extConfig((process.env.ONEOF_EXT_PASS as Pass) ?? 'app', mode === 'development'));
