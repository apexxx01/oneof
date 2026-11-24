/**
 * The inference ledger: every AI call OneOf makes, where it ran, how long it took and
 * exactly what (if anything) left the device. Firebase's console doesn't show on-device
 * calls, so we keep our own receipts and let the user export them.
 */
export type Task = 'extract' | 'draft' | 'blur' | 'baserate';
export type Mode = 'ONLY_ON_DEVICE' | 'PREFER_ON_DEVICE' | 'ONLY_IN_CLOUD' | 'PREFER_IN_CLOUD';

export interface LedgerEntry {
  id: number;
  at: string;
  task: Task;
  mode: Mode;
  reason: string;
  source: 'on_device' | 'in_cloud' | 'blocked' | 'error';
  ms: number;
  /** Exact text sent off-device (empty for on-device calls). */
  sentToCloud: string;
  decoy?: boolean;
  error?: string;
  /** Cloud model that answered, when a fallback tier was used. */
  model?: string;
}

type Listener = (entries: LedgerEntry[]) => void;
let entries: LedgerEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

export function record(e: Omit<LedgerEntry, 'id' | 'at'>): LedgerEntry {
  const full = { ...e, id: nextId++, at: new Date().toISOString() };
  entries = [...entries, full];
  listeners.forEach((l) => l(entries));
  return full;
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(entries);
  return () => listeners.delete(l);
}

export function getLedger() {
  return entries;
}

export function resetLedger() {
  entries = [];
  listeners.forEach((l) => l(entries));
}

export function summary(list = entries) {
  const onDevice = list.filter((e) => e.source === 'on_device').length;
  const cloud = list.filter((e) => e.source === 'in_cloud');
  const bytesOut = cloud.reduce((n, e) => n + new TextEncoder().encode(e.sentToCloud).length, 0);
  const postBytesOut = list
    .filter((e) => e.source === 'in_cloud' && (e.task === 'extract' || e.task === 'draft' || e.task === 'blur'))
    .reduce((n, e) => n + new TextEncoder().encode(e.sentToCloud).length, 0);
  return { total: list.length, onDevice, cloud: cloud.length, bytesOut, postBytesOut };
}
