import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // The vendored halves of `public/vision` — MediaPipe's own bundle and the
    // wasm glue it ships with. Not ours to lint, and linting them buries real
    // findings under a thousand from minified code. Named file by file rather
    // than by directory, because `tiledFaces.mjs` sits beside them and is ours.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/models/**',
      'release/**', '.wrangler/**',
      'public/vision/vision_bundle.mjs', 'public/vision/wasm/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Our own module in `public/`: plain browser ESM, served as-is rather than
    // bundled, so it is not covered by the TypeScript block above.
    files: ['public/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // The server, the build scripts and the Electron main process all run in
    // Node, not a browser.
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', 'electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    // The Electron entrypoint has to be CommonJS: Electron will load an ESM
    // main, but `app.whenReady()` never resolves under one and the app hangs
    // before it opens a window. require() here is deliberate, not legacy.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  }
);
