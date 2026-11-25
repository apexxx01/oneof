/**
 * Imported first by the panel entry, before any schema is built. Extension pages forbid eval,
 * so zod's JIT probe (`new Function`) would throw and log a CSP violation; jitless mode skips it.
 */
import { z } from 'zod';

z.config({ jitless: true });
