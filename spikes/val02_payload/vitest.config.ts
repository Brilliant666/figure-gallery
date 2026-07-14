import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@payload-config': path.resolve(import.meta.dirname, 'src/payload.config.ts'),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30_000,
  },
})
