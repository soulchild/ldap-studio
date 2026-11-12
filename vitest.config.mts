import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const alias = {
  '@shared': resolve(import.meta.dirname, 'src/shared'),
  '@renderer': resolve(import.meta.dirname, 'src/renderer/src'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        // Runs against the Docker servers from test/ldap (`pnpm test:env:up`); skipped when they are down.
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts', 'test/integration/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
