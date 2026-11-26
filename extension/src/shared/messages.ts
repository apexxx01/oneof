/**
 * Message shapes between the three extension contexts.
 *
 *   content script ──runtime.sendMessage──▶ service worker ──Port "oneof-engine"──▶ side panel (engine)
 *   content script ◀──tabs.sendMessage───── service worker ◀──Port─────────────── side panel
 *
 * Draft text travels only inside Chrome's extension messaging (in-process IPC). Nothing here
 * is ever sent over the network.
 */
import type { CrowdEstimate } from '../../../src/lib/types';

export const ENGINE_PORT = 'oneof-engine';

/** Colour family of the pill, same palette as the web app. */
export type Tone = 'idle' | 'device' | 'signal' | 'amber' | 'danger' | 'muted';

/** What the pill shows. Built by the engine (or locally by the content script for offline states). */
export interface Verdict {
  state: 'no-engine' | 'checking' | 'result' | 'blocked' | 'busy' | 'error' | 'short';
  text: string;
  tone: Tone;
  /** Longer explanation, used as the pill's tooltip. */
  detail?: string;
  /** The crowd numeral the pill shows big ("~1"); absent for status-only verdicts. */
  num?: string;
  /** The short mono status next to the numeral ("was ~50 · if you post this"). */
  note?: string;
  /** The draft makes the crowd smaller: the pill turns signal. */
  shrinks?: boolean;
}

// ---- content script -> service worker ----
export type FromContent =
  | { kind: 'draft'; seq: number; text: string; host: string }
  | { kind: 'open-panel' }
  | { kind: 'hello' };

/** Synchronous reply from the service worker to a content-script message. */
export interface Ack { engine: boolean }

// ---- service worker -> content script ----
export type ToContent =
  | { kind: 'verdict'; seq: number; verdict: Verdict }
  | { kind: 'engine'; ready: boolean }
  | { kind: 'apply-rewrite'; text: string };

// ---- service worker <-> side panel (Port) ----
export type ToPanel =
  | { kind: 'draft'; tabId: number; seq: number; text: string; host: string };

export type FromPanel =
  | { kind: 'verdict'; tabId: number; seq: number; verdict: Verdict }
  | { kind: 'apply-rewrite'; tabId: number; text: string }
  /** Port messages keep the worker awake while the panel is open, so verdicts stay fast. */
  | { kind: 'ping' };

export function isFromContent(m: unknown): m is FromContent {
  const k = (m as { kind?: unknown })?.kind;
  if (k === 'open-panel' || k === 'hello') return true;
  if (k !== 'draft') return false;
  const d = m as { seq?: unknown; text?: unknown; host?: unknown };
  return typeof d.seq === 'number' && typeof d.text === 'string' && typeof d.host === 'string';
}

export function isFromPanel(m: unknown): m is FromPanel {
  const d = m as { kind?: unknown; tabId?: unknown; seq?: unknown; text?: unknown; verdict?: unknown };
  if (d?.kind === 'verdict') return typeof d.tabId === 'number' && typeof d.seq === 'number' && typeof d.verdict === 'object';
  if (d?.kind === 'apply-rewrite') return typeof d.tabId === 'number' && typeof d.text === 'string';
  return d?.kind === 'ping';
}

/** Tone of a crowd band, matching .band-* colours in src/index.css. */
export function toneFor(band: CrowdEstimate['band']): Tone {
  return { handful: 'danger', room: 'signal', neighbourhood: 'amber', crowd: 'device' }[band] as Tone;
}

/** Shortest draft worth checking. */
export const MIN_DRAFT_CHARS = 12;
