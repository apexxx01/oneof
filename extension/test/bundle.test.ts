/**
 * Static checks over the extension's source and its built bundle (extension/dist, made by
 * `npm run ext:build`). They back the README's privacy claims:
 *  - minimal permissions, a CSP that only allows connections to the extension itself;
 *  - the content script and service worker have no network code and no model code;
 *  - extension code never names a cloud mode, never calls the cloud base-rate lookup, and passes
 *    'own' (=> ONLY_ON_DEVICE) to every model entry point;
 *  - the panel bundle doesn't contain the base-rate lookup or App Check's token exchange.
 * engine.test.ts proves the same thing at runtime, at the getGenerativeModel boundary.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ext = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(ext, 'dist');
const built = existsSync(join(dist, 'manifest.json'));
const read = (p: string) => readFileSync(p, 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

const HOSTS = ['https://www.reddit.com/*', 'https://old.reddit.com/*', 'https://sh.reddit.com/*'];
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|navigator\.connection/;

describe('extension source', () => {
  const files = walk(join(ext, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
  const src = Object.fromEntries(files.map((f) => [f.slice(ext.length + 1), read(f)]));

  it('never names a cloud inference mode or builds a model directly', () => {
    for (const [f, code] of Object.entries(src)) {
      expect(code, f).not.toMatch(/['"`](ONLY_IN_CLOUD|PREFER_IN_CLOUD|PREFER_ON_DEVICE|only_in_cloud|prefer_in_cloud|prefer_on_device)['"`]/);
      expect(code, f).not.toMatch(/InferenceMode\s*[.[]|getGenerativeModel\s*\(|from ['"]firebase\/ai['"]/);
    }
  });

  it('never imports the cloud base-rate lookup and never hands a model synthetic data', () => {
    for (const [f, code] of Object.entries(src)) {
      expect(code, f).not.toMatch(/\b(lookupBaseRate|refineRates|plannedLookups)\b\s*[,}(]/);
      expect(code, f).not.toMatch(/['"]synthetic['"]\s*[,)]/);
    }
  });

  it("passes 'own' to every model entry point (route('draft'|'blur'|'extract', 'own') = ONLY_ON_DEVICE)", () => {
    const engine = src['src/panel/engine.ts'];
    const callSites = [...engine.matchAll(/this\.deps\.(extract|blur|scan)\(([^;]*)/g)];
    expect(callSites.map((m) => m[1]).sort()).toEqual(['blur', 'extract', 'scan']);
    for (const m of callSites) expect(m[2], m[0]).toMatch(/'own'/);
    // Each is preceded by the guard that re-asks the router.
    for (const t of ['draft', 'blur', 'extract']) expect(engine).toContain(`assertOnDevice('${t}')`);
    // No other extension file calls the model entry points.
    for (const [f, code] of Object.entries(src)) {
      if (f === 'src/panel/engine.ts') continue;
      expect(code, f).not.toMatch(/\b(extractFromPost|blurDraft|coreBlur|coreScan)\s*\(|\bscan\s*\(\s*posts/);
    }
  });

  it('the content script and service worker contain no network or model code', () => {
    for (const [f, code] of Object.entries(src)) {
      if (!/^src\/(content|background|shared)\//.test(f)) continue;
      const body = f === 'src/background/sw.ts' ? code.replace(/if \(__ONEOF_DEV__\) \{[\s\S]*$/, '') : code; // dev-only reload poll
      expect(body, f).not.toMatch(NETWORK);
      expect(body, f).not.toMatch(/LanguageModel|firebase/i);
    }
  });
});

describe.skipIf(!built)('built bundle (extension/dist)', () => {
  const manifest = built ? JSON.parse(read(join(dist, 'manifest.json'))) : {};
  const all = built ? walk(dist) : [];
  const js = (re: RegExp) => all.filter((f) => re.test(f.slice(dist.length + 1))).map(read).join('\n');
  const dev = built && read(join(dist, 'build-id.txt')).includes('-dev');

  it('asks for minimal permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect([...manifest.permissions].sort()).toEqual(['sidePanel', 'storage']);
    expect([...manifest.host_permissions].sort()).toEqual([...HOSTS].sort());
    expect(manifest.optional_permissions ?? []).toEqual([]);
    expect(manifest.content_scripts).toHaveLength(1);
    expect([...manifest.content_scripts[0].matches].sort()).toEqual([...HOSTS].sort());
    expect(manifest.background).toEqual({ service_worker: 'sw.js', type: 'module' });
    expect(manifest.side_panel.default_path).toBe('sidepanel.html');
  });

  it('extension pages may connect only to the extension itself', () => {
    const csp: string = manifest.content_security_policy.extension_pages;
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it('ships every file it loads (no remote scripts or styles)', () => {
    const html = read(join(dist, 'sidepanel.html'));
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(m[1]).toMatch(/^\.\/assets\//);
      expect(existsSync(join(dist, m[1]))).toBe(true);
    }
    expect(existsSync(join(dist, manifest.content_scripts[0].js[0]))).toBe(true);
    for (const s of Object.values(manifest.icons) as string[]) expect(existsSync(join(dist, s))).toBe(true);
  });

  it('content.js is one classic script with no network, model or storage code', () => {
    const c = read(join(dist, 'content.js'));
    expect(c).not.toMatch(/^\s*import[\s{*]|\bimport\(|^export /m);
    expect(c).not.toMatch(NETWORK);
    expect(c).not.toMatch(/LanguageModel|firebase|chrome\.storage|localStorage|indexedDB/);
  });

  it('the service worker has no network code (production) and no model code', () => {
    const sw = read(join(dist, 'sw.js'));
    const chunks = [...sw.matchAll(/from\s*["']\.\/(assets\/[^"']+)["']/g)].map((m) => read(join(dist, m[1]))).join('\n');
    const code = sw + chunks;
    expect(code).not.toMatch(/LanguageModel|firebase/i);
    if (dev) {
      const fetches = code.match(/fetch\s*\(/g) ?? [];
      expect(fetches).toHaveLength(1);
      expect(code).toContain('build-id.txt');
    } else {
      expect(code).not.toMatch(NETWORK);
      expect(code).not.toContain('build-id.txt');
    }
  });

  it('the panel bundle has no base-rate lookup, no grounding tool, and no App Check token exchange', () => {
    const panel = js(/^assets\/.*\.js$/);
    expect(panel).not.toContain('googleSearch'); // lookupBaseRate's grounding tool, tree-shaken out
    expect(panel).not.toContain('using Google Search for current official statistics'); // BASERATE_SYSTEM
    expect(panel).not.toMatch(/exchangeToken|firebaseappcheck\.googleapis|recaptcha\/(api|enterprise)\.js/);
    expect(panel).toContain('App Check is compiled out of the OneOf extension');
  });

  it('lists every network-capable call left in the panel bundle (see README: none of them runs)', () => {
    const panel = js(/^assets\/.*\.js$/);
    const sites = [...panel.matchAll(/fetch\s*\(([^)]{0,60})/g)].map((m) => m[1]);
    // 1. @firebase/ai makeRequest: the cloud request path (unreachable: ONLY_ON_DEVICE + BlockedError guard)
    // 2. @firebase/ai ChromeAdapter: fetch(`data:...`) to turn an inline image into a Blob (text only here; data: is not network)
    // 3. demo.ts: fetch(chrome-extension://…/demo/p1-demo.json), a packaged file
    expect(sites).toHaveLength(3);
    expect(sites.some((s) => s.startsWith('`data:'))).toBe(true);
    expect(panel.match(/XMLHttpRequest/g) ?? []).toHaveLength(1); // PapaParse's remote-file reader; only used with download:true, which importers.ts never sets
    expect(panel).not.toMatch(/WebSocket|sendBeacon|EventSource/);
  });
});
