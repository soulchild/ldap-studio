import { builtinModules } from 'node:module'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const nodeBuiltins = builtinModules.flatMap((name) => [name, `node:${name}`])

/** `src/shared` runs in both processes and in unit tests, so it must stay free of Electron and Node APIs. */
const sharedBoundary = {
  paths: [
    { name: 'electron', message: 'src/shared must not depend on Electron.' },
    ...nodeBuiltins.map((name) => ({ name, message: 'src/shared must not use Node built-ins.' })),
  ],
  patterns: [
    {
      group: ['**/main/**', '**/preload/**', '**/renderer/**', '@renderer/*'],
      message: 'src/shared must not import app layers.',
    },
  ],
}

/** The renderer is sandboxed: it reaches main only through the preload API. */
const rendererBoundary = {
  paths: [
    { name: 'electron', message: 'The renderer must use window.api, not Electron directly.' },
    ...nodeBuiltins.map((name) => ({ name, message: 'The renderer has no Node APIs.' })),
  ],
  patterns: [
    {
      group: ['**/main/**', '**/src/main', '**/preload/index*'],
      message: 'The renderer must not import main-process code.',
    },
  ],
}

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'coverage/', 'node_modules/', '.pnpm-store/', 'scratchpad/', '.dev-app/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      curly: ['error', 'all'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      '*.config.{ts,mts,mjs}',
      'test/**/*.{ts,mjs}',
      'scripts/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Only relevant with the React Compiler, which this project does not use.
      'react-hooks/incompatible-library': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-imports': ['error', rendererBoundary],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', sharedBoundary] },
  },
)
