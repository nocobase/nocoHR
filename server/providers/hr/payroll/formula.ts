/**
 * V2-06 薪资公式: a small arithmetic language evaluated in the application,
 * never with `eval`. A formula has numbers, the four operations, parentheses,
 * `min`, `max`, `round` and `abs`, and variables from a whitelist:
 *
 * | Variable | Meaning |
 * |---|---|
 * | `base`, `allowance.<code>` | salary file |
 * | `dailyRate`, `hourlyRate`, `payableDays`, `payDaysPerMonth` | computed (the last is the structure's 月计薪天数) |
 * | `att.nightShiftCount`, `att.absentDays`, `att.shift.<code>`, `att.overtime.workday / restDay / holiday`, `att.leave.<code>` | the locked monthly attendance summary |
 * | `imp.<code>` | the month's imported value |
 * | `param.<code>` | the structure's parameters |
 * | `item.<code>` | an item earlier in the structure |
 * | `bonusBase` | the salary file's 绩效奖金基数 (V4-12) |
 * | `perf.coefficient` | the bonus coefficient of the final rating in the payroll cycle's review cycle (V4-12) |
 *
 * `×`, `÷` and full-width parentheses are accepted as written in policy
 * documents. Parsing produces a tree once; evaluation walks it with a
 * variable lookup, so a formula can reference only what the lookup offers.
 */

export type FormulaNode =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'variable'; readonly name: string }
  | {
      readonly type: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly left: FormulaNode;
      readonly right: FormulaNode;
    }
  | { readonly type: 'negate'; readonly operand: FormulaNode }
  | {
      readonly type: 'call';
      readonly fn: 'min' | 'max' | 'round' | 'abs';
      readonly args: readonly FormulaNode[];
    };

export class FormulaError extends Error {
  public readonly reason: string;
  public readonly detail: string | null;
  public constructor(reason: string, detail: string | null = null) {
    super(`${reason}${detail ? `: ${detail}` : ''}`);
    this.name = 'FormulaError';
    this.reason = reason;
    this.detail = detail;
  }
}

const FUNCTIONS = new Set(['min', 'max', 'round', 'abs']);
const MAX_LENGTH = 500;

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

function normalize(source: string): string {
  return source
    .replace(/×/gu, '*')
    .replace(/÷/gu, '/')
    .replace(/（/gu, '(')
    .replace(/）/gu, ')')
    .replace(/，/gu, ',')
    .replace(/－/gu, '-')
    .replace(/＋/gu, '+');
}

function tokenize(source: string): Token[] {
  const text = normalize(source);
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/u.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/u.test(ch)) {
      const match = /^(?:\d+(?:\.\d+)?|\.\d+)/u.exec(text.slice(i));
      if (!match)
        throw new FormulaError('FORMULA_SYNTAX', text.slice(i, i + 8));
      tokens.push({ kind: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/u.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/u.exec(
        text.slice(i),
      );
      tokens.push({ kind: 'name', value: match![0] });
      i += match![0].length;
      continue;
    }
    if ('+-*/(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new FormulaError('FORMULA_SYNTAX', ch);
  }
  return tokens;
}

/** Parses a formula; throws `FormulaError` with a stable reason on bad syntax. */
export function parseFormula(source: string): FormulaNode {
  if (typeof source !== 'string' || !source.trim())
    throw new FormulaError('FORMULA_EMPTY');
  if (source.length > MAX_LENGTH) throw new FormulaError('FORMULA_TOO_LONG');
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expectOp = (value: string) => {
    const token = take();
    if (!token || token.kind !== 'op' || token.value !== value)
      throw new FormulaError('FORMULA_SYNTAX', value);
  };

  function expression(): FormulaNode {
    let node = term();
    for (;;) {
      const token = peek();
      if (
        token?.kind === 'op' &&
        (token.value === '+' || token.value === '-')
      ) {
        take();
        node = {
          type: 'binary',
          op: token.value,
          left: node,
          right: term(),
        };
      } else return node;
    }
  }
  function term(): FormulaNode {
    let node = unary();
    for (;;) {
      const token = peek();
      if (
        token?.kind === 'op' &&
        (token.value === '*' || token.value === '/')
      ) {
        take();
        node = {
          type: 'binary',
          op: token.value,
          left: node,
          right: unary(),
        };
      } else return node;
    }
  }
  function unary(): FormulaNode {
    const token = peek();
    if (token?.kind === 'op' && token.value === '-') {
      take();
      return { type: 'negate', operand: unary() };
    }
    if (token?.kind === 'op' && token.value === '+') {
      take();
      return unary();
    }
    return primary();
  }
  function primary(): FormulaNode {
    const token = take();
    if (!token) throw new FormulaError('FORMULA_SYNTAX', 'end');
    if (token.kind === 'number') return { type: 'number', value: token.value };
    if (token.kind === 'op' && token.value === '(') {
      const node = expression();
      expectOp(')');
      return node;
    }
    if (token.kind === 'name') {
      const next = peek();
      if (next?.kind === 'op' && next.value === '(') {
        if (!FUNCTIONS.has(token.value))
          throw new FormulaError('FORMULA_UNKNOWN_FUNCTION', token.value);
        take();
        const args: FormulaNode[] = [];
        if (!(peek()?.kind === 'op' && peek()?.value === ')')) {
          args.push(expression());
          while (peek()?.kind === 'op' && peek()?.value === ',') {
            take();
            args.push(expression());
          }
        }
        expectOp(')');
        const fn = token.value as 'min' | 'max' | 'round' | 'abs';
        if (
          (fn === 'abs' && args.length !== 1) ||
          (fn === 'round' && (args.length < 1 || args.length > 2)) ||
          ((fn === 'min' || fn === 'max') && args.length < 1)
        )
          throw new FormulaError('FORMULA_ARGUMENTS', fn);
        return { type: 'call', fn, args };
      }
      return { type: 'variable', name: token.value };
    }
    throw new FormulaError('FORMULA_SYNTAX', token.value.toString());
  }

  const node = expression();
  if (position < tokens.length)
    throw new FormulaError('FORMULA_SYNTAX', String(tokens[position].value));
  return node;
}

/** Every variable a parsed formula reads, in order of first use. */
export function formulaVariables(node: FormulaNode): string[] {
  const names: string[] = [];
  const visit = (n: FormulaNode) => {
    if (n.type === 'variable') {
      if (!names.includes(n.name)) names.push(n.name);
    } else if (n.type === 'binary') {
      visit(n.left);
      visit(n.right);
    } else if (n.type === 'negate') visit(n.operand);
    else if (n.type === 'call') n.args.forEach(visit);
  };
  visit(node);
  return names;
}

/** Evaluates a parsed formula. Division by zero yields 0; a missing variable is 0. */
export function evaluateFormula(
  node: FormulaNode,
  lookup: (name: string) => number | undefined,
): number {
  const visit = (n: FormulaNode): number => {
    switch (n.type) {
      case 'number':
        return n.value;
      case 'variable': {
        const value = lookup(n.name);
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }
      case 'negate':
        return -visit(n.operand);
      case 'binary': {
        const a = visit(n.left);
        const b = visit(n.right);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? 0 : a / b;
      }
      case 'call': {
        const values = n.args.map(visit);
        if (n.fn === 'min') return Math.min(...values);
        if (n.fn === 'max') return Math.max(...values);
        if (n.fn === 'abs') return Math.abs(values[0]);
        const digits = Math.max(0, Math.min(6, Math.trunc(values[1] ?? 0)));
        return roundTo(values[0], digits);
      }
    }
  };
  return visit(node);
}

/** Half-up rounding that survives binary fractions (1.005 → 1.01). */
export function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  // toPrecision(15) drops the binary noise of the multiplication (1.005 × 100 = 100.49999…).
  return (
    (sign * Math.round(Number((Math.abs(value) * factor).toPrecision(15)))) /
    factor
  );
}

export const OVERTIME_TYPES = ['workday', 'restDay', 'holiday'] as const;

export interface VariableContext {
  /** Parameter codes of the structure. */
  readonly params: ReadonlySet<string>;
  /** Codes of the items before this one. */
  readonly earlierItems: ReadonlySet<string>;
  /** Codes of the structure's imported items. */
  readonly importedItems: ReadonlySet<string>;
}

const CODE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;

/**
 * Why a variable is not allowed here, or null when it is. `imp.<code>` must
 * name an imported item of the structure, `param.<code>` one of its
 * parameters and `item.<code>` an item placed earlier.
 */
export function variableProblem(
  name: string,
  context: VariableContext,
): string | null {
  const parts = name.split('.');
  const [head, second, third] = parts;
  if (parts.length === 1)
    return [
      'base',
      'dailyRate',
      'hourlyRate',
      'payableDays',
      'payDaysPerMonth',
      // V4-12
      'bonusBase',
    ].includes(head)
      ? null
      : 'FORMULA_UNKNOWN_VARIABLE';
  if (head === 'allowance')
    return parts.length === 2 && CODE.test(second)
      ? null
      : 'FORMULA_UNKNOWN_VARIABLE';
  if (head === 'att') {
    if (parts.length === 2)
      return second === 'nightShiftCount' || second === 'absentDays'
        ? null
        : 'FORMULA_UNKNOWN_VARIABLE';
    if (parts.length !== 3 || !CODE.test(third ?? ''))
      return 'FORMULA_UNKNOWN_VARIABLE';
    if (second === 'overtime')
      return (OVERTIME_TYPES as readonly string[]).includes(third)
        ? null
        : 'FORMULA_UNKNOWN_VARIABLE';
    return second === 'shift' || second === 'leave'
      ? null
      : 'FORMULA_UNKNOWN_VARIABLE';
  }
  if (parts.length !== 2) return 'FORMULA_UNKNOWN_VARIABLE';
  // V4-12
  if (head === 'perf')
    return second === 'coefficient' ? null : 'FORMULA_UNKNOWN_VARIABLE';
  if (head === 'imp')
    return context.importedItems.has(second) ? null : 'FORMULA_UNKNOWN_IMPORT';
  if (head === 'param')
    return context.params.has(second) ? null : 'FORMULA_UNKNOWN_PARAM';
  if (head === 'item')
    return context.earlierItems.has(second) ? null : 'FORMULA_ITEM_ORDER';
  return 'FORMULA_UNKNOWN_VARIABLE';
}

/** Parses and checks a formula against the whitelist; throws the first problem. */
export function checkFormula(
  source: string,
  context: VariableContext,
): FormulaNode {
  const node = parseFormula(source);
  for (const name of formulaVariables(node)) {
    const problem = variableProblem(name, context);
    if (problem) throw new FormulaError(problem, name);
  }
  return node;
}
