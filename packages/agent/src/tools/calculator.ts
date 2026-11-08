import { defineTool } from './define.js';

// A small arithmetic parser - never eval() model output.
// Supports + - * / % ^, parentheses, unary minus, decimals, and a few functions.
const FUNCTIONS = new Map<string, (x: number) => number>([
  ['sqrt', Math.sqrt],
  ['abs', Math.abs],
  ['round', Math.round],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['ln', Math.log],
  ['log10', Math.log10],
]);
const CONSTANTS = new Map<string, number>([
  ['pi', Math.PI],
  ['e', Math.E],
]);

export function evaluate(expression: string): number {
  const tokens = expression.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z_]+\d*|[-+*/%^()]|\S/gi) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const next = (): string | undefined => tokens[pos++];
  const expect = (t: string): void => {
    if (next() !== t) throw new Error(`Expected "${t}" in the expression.`);
  };

  const parseExpression = (): number => {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      value = next() === '+' ? value + parseTerm() : value - parseTerm();
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseUnary();
    for (let op = peek(); op === '*' || op === '/' || op === '%'; op = peek()) {
      next();
      const rhs = parseUnary();
      if (op !== '*' && rhs === 0) throw new Error('Division by zero.');
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
    }
    return value;
  };
  const parseUnary = (): number => {
    if (peek() === '-') {
      next();
      return -parseUnary();
    }
    if (peek() === '+') {
      next();
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): number => {
    const base = parsePrimary();
    if (peek() !== '^') return base;
    next();
    return base ** parseUnary(); // right-associative
  };
  const parsePrimary = (): number => {
    const token = next();
    if (token === undefined) throw new Error('The expression ended unexpectedly.');
    if (token === '(') {
      const value = parseExpression();
      expect(')');
      return value;
    }
    if (/^(\d|\.\d)/.test(token)) return Number(token);
    const name = token.toLowerCase();
    const constant = CONSTANTS.get(name);
    if (constant !== undefined) return constant;
    const fn = FUNCTIONS.get(name);
    if (fn) {
      expect('(');
      const arg = parseExpression();
      expect(')');
      return fn(arg);
    }
    throw new Error(`Unknown symbol "${token}".`);
  };

  if (tokens.length === 0) throw new Error('The expression is empty.');
  const result = parseExpression();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos]}" in the expression.`);
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number.');
  return result;
}

export const calculator = defineTool<{ expression: string }>({
  name: 'calculator',
  description:
    'Evaluate an arithmetic expression exactly. Call this for any calculation beyond trivial mental math (money, percentages, multi-step arithmetic). Supports + - * / % ^, parentheses, sqrt, abs, round, floor, ceil, ln, log10, pi and e.',
  properties: {
    expression: {
      type: 'string',
      description: 'For example "(1250 * 0.13) + 49.99" or "sqrt(2) ^ 3".',
    },
  },
  async run({ expression }) {
    return { expression, result: evaluate(expression) };
  },
});
