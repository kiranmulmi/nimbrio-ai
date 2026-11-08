import reactHooks from 'eslint-plugin-react-hooks';
import base from './index.js';

/**
 * Base config plus the two hook rules docs/standards.md makes mandatory.
 * The plugin's own `recommended` preset also turns on the React Compiler rules
 * (`set-state-in-effect`, `purity`, `immutability`, ...). They are deliberately
 * left off here: `set-state-in-effect` rejects the `usePageHeader` pattern this
 * boilerplate is built around. Opt in per app if you want them.
 */
export default [
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
];
