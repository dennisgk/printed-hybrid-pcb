/** Arithmetic only: no JavaScript, identifiers, functions, or implicit multiplication. */
export function evaluateExpression(source: string): number {
  if (!source.trim()) throw new Error('Enter a number or arithmetic expression.')
  if (source.length > 512) throw new Error('Expression is too long.')
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[^\s]/g) ?? []
  let at = 0, depth = 0
  const finite = (n: number) => { if (!Number.isFinite(n)) throw new Error('Expression must resolve to a finite number.'); return n }
  function primary(): number {
    if (++depth > 64) throw new Error('Expression is nested too deeply.')
    const t = tokens[at++]
    let value: number
    if (t === '(') { value = sum(); if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis.') }
    else if (t && /^(?:\d|\.)/.test(t) && Number.isFinite(Number(t))) value = Number(t)
    else throw new Error(`Expected a number${t ? `, found “${t}”` : ''}.`)
    depth--; return finite(value)
  }
  function power(): number { const value = primary(); if (tokens[at] === '^') { at++; return finite(value ** unary()) } return value }
  function unary(): number { if (tokens[at] === '+' || tokens[at] === '-') { const sign = tokens[at++] === '-' ? -1 : 1; if (++depth > 64) throw new Error('Expression is nested too deeply.'); const n = sign * unary(); depth--; return n } return power() }
  function product(): number { let value = unary(); while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++], right = unary(); if (op === '/' && right === 0) throw new Error('Cannot divide by zero.'); value = finite(op === '*' ? value * right : value / right) } return value }
  function sum(): number { let value = product(); while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++], right = product(); value = finite(op === '+' ? value + right : value - right) } return value }
  const value = sum()
  if (at !== tokens.length) throw new Error(`Unexpected “${tokens[at]}”. Use +, -, *, /, ^ and parentheses.`)
  return finite(value)
}
