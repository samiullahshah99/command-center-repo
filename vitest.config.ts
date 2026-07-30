import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // 'node' rather than 'jsdom': the first things worth testing here are
    // webhook signature verification and payload parsing, which are pure
    // server-side logic. A DOM environment would add cost for nothing.
    // Component tests would need jsdom + @testing-library — add per-file with
    // an `// @vitest-environment jsdom` comment if that day comes.
    environment: 'node',

    globals: false, // import { describe, it, expect } explicitly

    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.{test,spec}.ts'],

    exclude: ['node_modules/**', '.next/**', 'drizzle/**'],

    // Tests must not silently depend on .env.local. Anything needing a secret
    // should mock it or set process.env explicitly inside the test, so the
    // suite behaves the same on a laptop and in CI.
    env: {}
  },

  resolve: {
    alias: {
      // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json. Declared by
      // hand rather than via vite-tsconfig-paths to avoid another dependency;
      // if a second alias is ever added to tsconfig, add it here too.
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
});
