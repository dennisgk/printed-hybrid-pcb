import { describe, expect, it } from 'vitest'
import { evaluateExpression as evaluate } from '../src/lib/expression'
describe('constraint arithmetic', () => {
  it.each([['1*1', 1], ['2+2', 4], ['2+2*3', 8], ['(2+2)*3', 12], ['8/2*3', 12], ['2^3^2', 512], ['-2^2', -4], ['(-2)^2', 4], ['2^-2', .25], [' 1.5 + .5 ', 2], ['1e-3*1000', 1], ['2--2', 4]])('evaluates %s', (source, expected) => expect(evaluate(source)).toBe(expected))
  it.each(['', '2/0', '2+(3', '2**3', '1 2', '2(3)', 'Math.random()', 'alert(1)', 'NaN', 'Infinity', '10^999', '0^-1'])('rejects %s without executing code', source => expect(() => evaluate(source)).toThrow())
})
