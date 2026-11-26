/**
 * The inference ledger: every AI call OneOf makes, where it ran, how long it took and
 * exactly what (if anything) left the device. Firebase's console doesn't show on-device
 * calls, so we keep our own receipts and let the user export them.
 */
export type Task = 'extract' | 'draft' | 'blur' | 'baserate' | 'match';
export type Mode = 'ONLY_ON_DEVICE' | 'PREFER_ON_DEVICE' | 'ONLY_IN_CLOUD' | 'PREFER_IN_CLOUD';

export interface LedgerEntry {
  id: number;
  at: string;
  task: Task;
  mode: Mode;
  reason: string;
  /** 'stopped' = the user stopped the run while this call was in flight; not a failure. */
  source: 'on_device' | 'in_cloud' | 'blocked' | 'error' | 'stopped';
  ms: number;
  /** Exact text sent off-device (empty for on-device calls). */
  sentToCloud: string;
  decoy?: boolean;
  error?: string;
  /** Cloud model that answered, when a fallback tier was used. */
  model?: string;
  /** Played back from a recorded on-device run, not run in this browser. */
  replay?: boolean;
  /** Whose words were in the call: the user's own ('own') or the synthetic demo persona. */
  data?: 'own' | 'synthetic';
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

const bytes = (t: string) => new TextEncoder().encode(t).length;
const POST_TASKS = new Set<Task>(['extract', 'draft', 'blur']);

export function summary(list = entries) {
  const onDevice = list.filter((e) => e.source === 'on_device').length;
  const cloud = list.filter((e) => e.source === 'in_cloud');
  // Bytes count whenever something left the device, including calls that then failed or were stopped.
  const sent = list.filter((e) => e.sentToCloud);
  const bytesOut = sent.reduce((n, e) => n + bytes(e.sentToCloud), 0);
  const postSent = sent.filter((e) => POST_TASKS.has(e.task));
  /** Total post text sent, own and demo together (kept for receipts exported before the split). */
  const postBytesOut = postSent.reduce((n, e) => n + bytes(e.sentToCloud), 0);
  // An entry without a data label is counted as the user's own: the cautious reading.
  const demoPostBytesOut = postSent.filter((e) => e.data === 'synthetic').reduce((n, e) => n + bytes(e.sentToCloud), 0);
  const ownPostBytesOut = postBytesOut - demoPostBytesOut;
  // Generic attributes sent for base-rate lookups, counted separately and shown next to post bytes.
  const attrBytesOut = sent.filter((e) => e.task === 'baserate').reduce((n, e) => n + bytes(e.sentToCloud), 0);
  const replayed = list.filter((e) => e.replay).length;
  const stopped = list.filter((e) => e.source === 'stopped').length;
  return { total: list.length, onDevice, cloud: cloud.length, bytesOut, postBytesOut, ownPostBytesOut, demoPostBytesOut, attrBytesOut, replayed, stopped };
}

export type LedgerSummary = ReturnType<typeof summary>;
