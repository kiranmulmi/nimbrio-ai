/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Every colour is a CSS variable from index.css, so light and dark flip together.
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        subtle: 'var(--subtle)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        line: {
          DEFAULT: 'var(--line)',
          2: 'var(--line-2)',
          strong: 'var(--line-strong)',
        },
        // The token usage bars: input read from the cache, the rest of the input, output.
        usage: {
          cached: 'var(--usage-cached)',
          input: 'var(--usage-input)',
          output: 'var(--usage-output)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          2: 'var(--accent-2)',
          bg: 'var(--accent-bg)',
          soft: 'var(--accent-soft)',
        },
        'on-accent': 'var(--on-accent)',
        coral: {
          DEFAULT: 'var(--coral)',
          bg: 'var(--coral-bg)',
        },
        overlay: 'var(--overlay)',
        focus: 'var(--focus)',
        success: {
          DEFAULT: 'var(--success)',
          bg: 'var(--success-bg)',
          line: 'var(--success-line)',
        },
        warn: {
          DEFAULT: 'var(--warn)',
          bg: 'var(--warn-bg)',
          line: 'var(--warn-line)',
        },
        // File tree tints (index.css): text-ft-ts, text-ft-folder, ...
        ft: {
          folder: 'var(--ft-folder)',
          ts: 'var(--ft-ts)',
          js: 'var(--ft-js)',
          json: 'var(--ft-json)',
          npm: 'var(--ft-npm)',
          style: 'var(--ft-style)',
          markup: 'var(--ft-markup)',
          doc: 'var(--ft-doc)',
          python: 'var(--ft-python)',
          shell: 'var(--ft-shell)',
          config: 'var(--ft-config)',
          image: 'var(--ft-image)',
          data: 'var(--ft-data)',
          code: 'var(--ft-code)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg: 'var(--danger-bg)',
          line: 'var(--danger-line)',
        },
      },
      fontFamily: {
        // The font itself is --font-sans in index.css, so it can change without a rebuild.
        sans: ['var(--font-sans)'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
        // VS Code's own interface font (its file explorer): the system UI font on each OS.
        explorer: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe WPC"',
          '"Segoe UI"',
          '"Ubuntu"',
          '"Droid Sans"',
          'system-ui',
          'sans-serif',
        ],
      },
      // Corners come from the --radius-* scale in index.css, so they change in one place.
      borderRadius: {
        md: 'var(--radius-tiny)',
        lg: 'var(--radius-small)',
        xl: 'var(--radius-control)',
        '2xl': 'var(--radius-card)',
      },
      // Cards float softly (card); menus and dialogs float higher; accent buttons glow.
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        dialog: 'var(--shadow-dialog)',
        accent: 'var(--shadow-accent)',
      },
      keyframes: {
        blink: { '50%': { opacity: '0.25' } },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '0 0' },
        },
        'dot-bounce': {
          '0%, 60%, 100%': { opacity: '0.3', transform: 'none' },
          '30%': { opacity: '1', transform: 'translateY(-2px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.6)' },
          '70%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
        enter: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'voice-wave': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        // Toasts rise in from below; the bar under each one empties as its time runs out.
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        'toast-timer': {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
      },
      animation: {
        blink: 'blink 1s ease-in-out infinite',
        'blink-slow': 'blink 1.4s ease-in-out infinite',
        shimmer: 'shimmer 1.4s linear infinite',
        'dot-bounce': 'dot-bounce 1s ease-in-out infinite',
        pop: 'pop 0.35s ease-out',
        enter: 'enter 0.35s ease-out',
        'spin-fast': 'spin 0.8s linear infinite',
        'voice-wave': 'voice-wave 0.9s ease-in-out infinite',
        'toast-in': 'toast-in 0.22s ease-out',
        // Its duration is set inline per toast (animationDuration).
        'toast-timer': 'toast-timer linear forwards',
      },
    },
  },
  plugins: [],
};
