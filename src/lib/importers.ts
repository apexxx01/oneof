import JSZip from 'jszip';
import Papa from 'papaparse';
import type { Post } from './types';

/**
 * Importers for the user's OWN data. Everything is parsed locally in the browser.
 * Reddit exports also contain IP logs, messages and chat history. Only posts.csv and comments.csv
 * are read (an allow-list); every other file is listed as skipped and never opened.
 */

export interface ImportResult { posts: Post[]; skippedFiles: string[]; format: string }

export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.zip')) return importRedditZip(await file.arrayBuffer());
  const text = await file.text();
  if (name.endsWith('.json')) return { posts: fromJson(text), skippedFiles: [], format: 'JSON' };
  if (name.endsWith('.csv')) return { posts: fromCsv(text, 'csv'), skippedFiles: [], format: 'CSV' };
  return { posts: fromPaste(text), skippedFiles: [], format: 'Text' };
}

export async function importRedditZip(buf: ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buf);
  const posts: Post[] = [];
  const skippedFiles: string[] = [];
  for (const path of Object.keys(zip.files)) {
    const base = path.split('/').pop() ?? path;
    if (base === 'posts.csv' || base === 'comments.csv') {
      posts.push(...fromCsv(await zip.files[path].async('string'), base.replace('.csv', '')));
    } else if (!zip.files[path].dir) {
      skippedFiles.push(base);
    }
  }
  return { posts: dedupe(posts), skippedFiles, format: 'Reddit data export' };
}

const DELETED_BODIES = new Set(['[deleted]', '[removed]']);

function fromCsv(text: string, kind: string): Post[] {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return parsed.data
    // Check the body fields themselves: a titled post with a deleted body would otherwise
    // survive, because the joined "title — [deleted]" string never equals "[deleted]".
    .filter((row) => ![row.body, row.text, row.content].some((v) => DELETED_BODIES.has((v ?? '').trim())))
    .map((row, i) => {
      // We deliberately ignore the "ip" column and anything else not listed here.
      const body = [row.title, row.body, row.text, row.content].filter(Boolean).join(' — ').trim();
      return {
        id: row.id || `${kind}_${i}`,
        date: toIso(row.date || row.created_utc || row.created_at || row.timestamp),
        text: body,
        where: row.subreddit || row.channel || undefined,
        permalink: row.permalink || undefined,
      };
    })
    .filter((p) => p.text && p.text !== '[deleted]' && p.text !== '[removed]');
}

function fromJson(text: string): Post[] {
  const raw = JSON.parse(text) as unknown;
  const arr: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { posts?: unknown }).posts) ? ((raw as { posts: Array<Record<string, unknown>> }).posts) : [];
  return arr
    .map((r, i) => ({
      id: String(r.id ?? `json_${i}`),
      date: toIso(String(r.date ?? r.created_at ?? r.created_utc ?? r.timestamp ?? '')),
      text: String(r.text ?? r.body ?? r.content ?? r.full_text ?? '').trim(),
      where: (r.subreddit ?? r.where ?? r.channel) as string | undefined,
      permalink: (r.permalink ?? r.url) as string | undefined,
    }))
    .filter((p) => p.text);
}

export function fromPaste(text: string): Post[] {
  return text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `paste_${i}`, date: new Date().toISOString(), text: t }));
}

function toIso(v?: string): string {
  if (!v) return new Date(0).toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function dedupe(posts: Post[]) {
  const seen = new Set<string>();
  return posts.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
