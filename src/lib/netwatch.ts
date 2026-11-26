/**
 * Counts model requests that actually went over the network, from the browser's own Resource
 * Timing entries (not from our ledger), so the "0 B sent" claim can be checked independently.
 * Only Firebase AI Logic / Gemini endpoints count; fonts, the page and App Check are listed apart.
 */
export const AI_HOSTS = /firebasevertexai\.googleapis\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/;

export function countAiRequests(since: number, entries: Array<{ name: string; startTime: number }>): number {
  return entries.filter((e) => e.startTime >= since && AI_HOSTS.test(e.name)).length;
}

/** Calls `cb` with the running count of AI requests since `since` (performance.now() time). */
export function watchAiRequests(since: number, cb: (n: number) => void): () => void {
  if (typeof performance === 'undefined' || typeof PerformanceObserver === 'undefined') return () => undefined;
  const tick = () => cb(countAiRequests(since, performance.getEntriesByType('resource') as PerformanceResourceTiming[]));
  tick();
  const po = new PerformanceObserver(tick);
  try { po.observe({ type: 'resource', buffered: true }); } catch { /* old browsers */ }
  return () => po.disconnect();
}
