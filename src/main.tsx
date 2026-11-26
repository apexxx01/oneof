import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/big-shoulders/opsz.css';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource-variable/martian-mono/wdth.css';
import './index.css';
import App from './App.tsx';
import { applyTheme, storedTheme } from './ui/bits';

// A saved theme wins; otherwise the stylesheet follows prefers-color-scheme (dark when unknown).
applyTheme(storedTheme());

// /?spike keeps the day-1 extraction benchmark reachable for re-running receipts.
const Spike = lazy(() => import('./spike/S1.tsx'));
const q = new URLSearchParams(location.search);
const isSpike = q.has('spike');
// /?eval runs the held-out SynthPAI evaluation in the browser (data fetched live, never vendored).
const Eval = lazy(() => import('./eval/Eval.tsx'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSpike ? <Suspense fallback={null}><Spike /></Suspense> : q.has('eval') ? <Suspense fallback={null}><Eval /></Suspense> : <App />}</StrictMode>,
);
