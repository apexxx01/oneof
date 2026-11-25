/**
 * Live proof for the ledger line: counts every network request this panel's document makes
 * (Resource Timing sees fetch, XHR, images, scripts…). Requests to chrome-extension:// are the
 * extension's own packaged files and are not network traffic. The panel's CSP (connect-src
 * 'self') would block any other connection anyway; this counter shows it.
 */
export function watchNetwork(onChange: (urls: string[]) => void): () => void {
  const seen: string[] = [];
  const take = (list: PerformanceEntryList) => {
    let changed = false;
    for (const e of list) {
      if (/^(https?|wss?):/i.test(e.name)) { seen.push(e.name); changed = true; }
    }
    if (changed) onChange([...seen]);
  };
  if (typeof PerformanceObserver === 'undefined') return () => undefined;
  const obs = new PerformanceObserver((l) => take(l.getEntries()));
  try { obs.observe({ type: 'resource', buffered: true }); } catch { return () => undefined; }
  onChange([...seen]);
  return () => obs.disconnect();
}
