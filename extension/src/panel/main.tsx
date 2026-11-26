import './zod-csp'; // must stay first: configures zod before src/lib/schemas.ts builds its schemas
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/big-shoulders/opsz.css';
import '@fontsource-variable/schibsted-grotesk';
import '@fontsource-variable/martian-mono/wdth.css';
import '../../../src/index.css';
import './panel.css';
import { applyTheme, storedTheme } from '../../../src/ui/bits';
import { App } from './App';

applyTheme(storedTheme());
createRoot(document.getElementById('root')!).render(<App />);
