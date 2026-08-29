import nkzw from '@nkzw/oxlint-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    experimentalSortImports: {
      newlinesBetween: false,
    },
    experimentalSortPackageJson: {
      sortScripts: true,
    },
    ignorePatterns: ['coverage', 'demo/dist', 'pnpm-lock.yaml'],
    singleQuote: true,
  },
  lint: {
    extends: [nkzw],
    ignorePatterns: ['coverage', 'demo/dist', 'lib'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
  },
  pack: {
    entry: ['src/index.ts'],
    outDir: 'lib',
    platform: 'browser',
    target: 'es2022',
  },
  run: {
    tasks: {
      'benchmark:all': {
        cache: false,
        command: [
          'vp test bench benchmark',
          'vp pack',
          'node --expose-gc benchmark/controller-memory.mjs',
        ],
      },
      'test:all': {
        command: 'vp check && vp test',
      },
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    include: ['test/**/*.test.ts'],
  },
});
