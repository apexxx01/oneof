import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  define: { __ONEOF_DEV__: 'false' },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
