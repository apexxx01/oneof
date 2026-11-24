import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// /?spike keeps the day-1 extraction benchmark reachable for re-running receipts.
const Spike = lazy(() => import('./spike/S1.tsx'));
const isSpike = new URLSearchParams(location.search).has('spike');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSpike ? <Suspense fallback={null}><Spike /></Suspense> : <App />}</StrictMode>,
);
