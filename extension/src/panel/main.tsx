import './zod-csp'; // must stay first: configures zod before src/lib/schemas.ts builds its schemas
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import './panel.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
