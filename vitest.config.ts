import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          setupFiles: ['tests/setup/dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/exports/**'],
    },
  },
})
