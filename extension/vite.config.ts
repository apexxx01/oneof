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
      // Never inline assets as data: URLs: the panel's CSP (default-src 'self') would block a data: font.
      // The pill's fonts are inlined on purpose with ?inline (see src/content/pill.ts).
      assetsInlineLimit: 0,
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

/** A small PNG of the "1/" mark (same drawing as public/favicon.svg): off-white tile, black 1, signal slash. */
function icon(size: number): Uint8Array {
  // The mark on a 32-unit grid; 4×4 supersampling for clean edges at 16 px.
  const one: Array<[number, number]> = [[8.5, 9.5], [12.5, 7], [15.5, 7], [15.5, 25], [11.5, 25], [11.5, 12.2], [8.5, 13.8]];
  const slash: Array<[number, number]> = [[19.5, 25], [24, 7], [27.2, 7], [22.7, 25]];
  const inside = (poly: Array<[number, number]>, x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const colour = (x: number, y: number): [number, number, number] => {
    if (x < 2 || y < 2 || x > 30 || y > 30) return [0x0a, 0x0a, 0x0a];
    if (inside(one, x, y)) return [0x0a, 0x0a, 0x0a];
    if (inside(slash, x, y)) return [0xff, 0x4a, 0x1c];
    return [0xf5, 0xf5, 0xf2];
  };
  const px = new Uint8Array(size * (size * 4 + 1));
  const S = 4;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const [cr, cg, cb] = colour(((x + (sx + 0.5) / S) / size) * 32, ((y + (sy + 0.5) / S) / size) * 32);
        r += cr; g += cg; b += cb;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      px[o] = Math.round(r / (S * S)); px[o + 1] = Math.round(g / (S * S)); px[o + 2] = Math.round(b / (S * S)); px[o + 3] = 255;
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
