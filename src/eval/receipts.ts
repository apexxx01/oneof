/**
 * The committed held-out receipts (receipts/heldout-*.json), bundled at build time so /?eval
 * shows real numbers without Gemini Nano. Nothing here is computed in the browser.
 */
export interface HeldoutSummary { labelRecall: number; hit: number; total: number; quietRate: number; negWithFacts: number; neg: number; p50: number; p95: number; errors: number; onDevice: number; n: number }
interface HeldoutReceipt { arm: 'on_device' | 'cloud'; prompt?: string; perKind: number; summary: HeldoutSummary }
interface PrefilterReceipt { comments: number; revealing: { n: number; kept: number; recall: string }; quiet: { n: number; kept: number; sentToModel: string } }

const files = import.meta.glob<HeldoutReceipt | PrefilterReceipt>('../../receipts/heldout-*.json', { eager: true, import: 'default' });
const name = (path: string) => path.split('/').pop()!;

export const REPO = 'https://github.com/apexxx01/oneof';
export const receiptUrl = (file: string) => `${REPO}/blob/main/receipts/${file}`;

/** Display order: shipped prompt first, then earlier prompts, then the cloud baseline. */
const ORDER = ['heldout-synthpai-on_device-x2r.json', 'heldout-synthpai-on_device.json', 'heldout-synthpai-on_device-x3-rejected.json', 'heldout-synthpai-cloud.json'];

function labelFor(r: HeldoutReceipt) {
  if (r.arm === 'cloud') return `Cloud baseline (ONLY_IN_CLOUD), ${r.perKind} + ${r.perKind} comments`;
  // The first on-device receipt predates the prompt field; it was recorded with prompt x2.
  return `Gemini Nano (ONLY_ON_DEVICE), prompt ${r.prompt ?? 'x2'}, ${r.perKind} + ${r.perKind} comments`;
}

export const COMMITTED = Object.entries(files)
  .filter(([path, r]) => !name(path).includes('prefilter') && 'summary' in r)
  .map(([path, r]) => ({ file: name(path), label: labelFor(r as HeldoutReceipt), summary: (r as HeldoutReceipt).summary }))
  .sort((a, b) => (ORDER.indexOf(a.file) + 1 || 99) - (ORDER.indexOf(b.file) + 1 || 99));

export const PREFILTER = Object.entries(files).map(([, r]) => r).find((r): r is PrefilterReceipt => 'revealing' in r);
