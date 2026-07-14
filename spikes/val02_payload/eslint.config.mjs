import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    '.next/**',
    'coverage/**',
    'media/**',
    'src/app/(payload)/admin/importMap.js',
    'src/migrations/**',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
