import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The demo history file: recording metadata, every fact the recorded on-device run found, and
 * only the posts those facts quote (needed to re-check them with verify()). The persona's
 * answer key ("truth", "traps") is deliberately left out.
 */
export function demoFile() {
  const replay = JSON.parse(readFileSync(resolve(repo, 'public/personas/p1-replay.json'), 'utf8'));
  const persona = JSON.parse(readFileSync(resolve(repo, 'public/personas/p1.json'), 'utf8'));
  if (!persona.synthetic) throw new Error('demo persona must be synthetic');
  const facts = (replay.log as Array<{ facts: Array<{ postId: string }> }>).flatMap((e) => e.facts);
  const ids = new Set(facts.map((f) => f.postId));
  const posts = (persona.posts as Array<{ id: string; date: string; text: string }>).filter((p) => ids.has(p.id)).map(({ id, date, text }) => ({ id, date, text }));
  // The recorded on-device check of the sample draft: played on the practice page, labelled, when
  // this computer has no Gemini Nano.
  const draft = replay.draft ? { text: replay.draft.text, recordedAt: replay.draft.recordedAt, userAgent: replay.draft.userAgent, sentences: replay.draft.sentences } : undefined;
  return { persona: replay.persona, synthetic: true, recordedAt: replay.recordedAt, userAgent: replay.userAgent, postsTotal: replay.postsTotal, facts, posts, draft };
}
