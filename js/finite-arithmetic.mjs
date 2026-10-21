// Reused from Saint js/x87-finite.mjs; exact finite dyadic operations.
// Provenance and scope: docs/oracle-baseline.md. No Gamma backend claim.
const bits = n => (n < 0n ? -n : n).toString(2).length;
export function round(value, precision, rc) {
  if (value.infinity || value.nan) return value;
  if (value.n === 0n) return value;
  const negative = value.n < 0n;
  let n = negative ? -value.n : value.n;
  const shift = bits(n) - precision;
  if (shift <= 0) return value;
  let q = n >> BigInt(shift);
  const remainder = n - (q << BigInt(shift));
  const halfway = 1n << BigInt(shift - 1);
  if ((rc === 0 && (remainder > halfway || (remainder === halfway && (q & 1n)))) ||
      (remainder !== 0n && ((rc === 1 && negative) || (rc === 2 && !negative)))) q += 1n;
  const carryShift = bits(q) > precision ? 1 : 0;
  q >>= BigInt(carryShift);
  return { n: negative ? -q : q, e: value.e + shift + carryShift, negativeZero: false };
}
export function from64(hex) {
  return from64Bits(BigInt('0x' + hex));
}
export function from64Bits(raw) {
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & ((1n << 52n) - 1n);
  const negative = (raw >> 63n) !== 0n;
  if(exponent===0x7ff&&fraction===0x8000000000000n)return {n:0n,e:0,negativeZero:false,nan:true,negative};
  if (exponent === 0x7ff && fraction === 0n) return {n:negative?-1n:1n,e:0,negativeZero:false,infinity:true};
  if (exponent === 0x7ff || (exponent === 0 && fraction !== 0n)) throw new Error('Unsupported NaN/subnormal input');
  const n = exponent === 0 ? 0n : (1n << 52n) | fraction;
  return { n: negative ? -n : n, e: exponent === 0 ? 0 : exponent - 1023 - 52, negativeZero: negative && n === 0n };
}
export function raw80(value) {
  if(value.nan)return {mantissa_hex:'c000000000000000',exponent_hex:value.negative?'ffff':'7fff'};
  if(value.infinity)return {mantissa_hex:'8000000000000000',exponent_hex:value.n<0n?'ffff':'7fff'};
  if (value.n === 0n) return { mantissa_hex: '0000000000000000', exponent_hex: value.negativeZero ? '8000' : '0000' };
  const negative = value.n < 0n;
  const n = negative ? -value.n : value.n;
  const length = bits(n);
  const exponent = value.e + length - 1 + 16383;
  if (exponent <= 0 || exponent >= 32767 || length > 64) throw new Error('Unsupported extended range/precision');
  return { mantissa_hex: (n << BigInt(64 - length)).toString(16).padStart(16, '0'),
    exponent_hex: (exponent | (negative ? 0x8000 : 0)).toString(16).padStart(4, '0') };
}
export function to64(value, rc) {
  return to64Bits(value, rc).toString(16).padStart(16, '0');
}
export function to64Bits(value, rc) {
  if(value.nan)return value.negative?0xfff8000000000000n:0x7ff8000000000000n;
  if(value.infinity)return value.n<0n?0xfff0000000000000n:0x7ff0000000000000n;
  const rounded = round(value, 53, rc);
  const negative = rounded.n < 0n || rounded.negativeZero;
  const n = rounded.n < 0n ? -rounded.n : rounded.n;
  if (n === 0n) return negative ? 0x8000000000000000n : 0n;
  const length = bits(n);
  const exponent = rounded.e + length - 1 + 1023;
  if (exponent <= 0 || exponent >= 2047) throw new Error('Unsupported binary64 store range');
  const fraction = (n << BigInt(53 - length)) & ((1n << 52n) - 1n);
  return (negative ? 1n << 63n : 0n) | (BigInt(exponent) << 52n) | fraction;
}
export function multiply(a, b, precision, rc) {
  if(a.nan||b.nan)return {...(a.nan?a:b)};
  if(a.infinity||b.infinity){if(a.n===0n||b.n===0n)return {n:0n,e:0,negativeZero:false,nan:true,negative:true};return {n:(a.n<0n||a.negativeZero)!==(b.n<0n||b.negativeZero)?-1n:1n,e:0,negativeZero:false,infinity:true};}
  return round({ n: a.n * b.n, e: a.e + b.e,
    negativeZero: (a.n < 0n || a.negativeZero) !== (b.n < 0n || b.negativeZero) }, precision, rc);
}
export function subtract(a, b, precision, rc) {
  if(a.nan||b.nan)return {...(a.nan?a:b)};
  if(a.infinity||b.infinity)return add(a,{...b,n:-b.n,negativeZero:b.n===0n?!b.negativeZero:false},precision,rc);
  const e = Math.min(a.e, b.e);
  const n = (a.n << BigInt(a.e - e)) - (b.n << BigInt(b.e - e));
  const negativeZeroDifference = a.n === 0n && b.n === 0n && a.negativeZero && !b.negativeZero;
  return round({ n, e, negativeZero: n === 0n && (negativeZeroDifference || rc === 1) }, precision, rc);
}
export function add(a, b, precision, rc) {
  if(a.nan||b.nan)return {...(a.nan?a:b)};
  if(a.infinity||b.infinity){if(a.infinity&&b.infinity&&(a.n<0n)!==(b.n<0n))return {n:0n,e:0,negativeZero:false,nan:true,negative:true};return {...(a.infinity?a:b)};}
  const e = Math.min(a.e, b.e);
  const n = (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e));
  const bothNegativeZero = a.n === 0n && b.n === 0n && a.negativeZero && b.negativeZero;
  return round({ n, e, negativeZero: n === 0n && (bothNegativeZero || rc === 1) }, precision, rc);
}
export function divide(a, b, precision, rc) {
  if(a.nan||b.nan)return {...(a.nan?a:b)};
  if (b.n === 0n) throw new Error('Division by zero unsupported');
  const negative = (a.n < 0n || a.negativeZero) !== (b.n < 0n || b.negativeZero);
  if(a.infinity&&b.infinity)return {n:0n,e:0,negativeZero:false,nan:true,negative:true};
  if(a.infinity)return {n:negative?-1n:1n,e:0,negativeZero:false,infinity:true};
  if(b.infinity)return {n:0n,e:0,negativeZero:negative};
  if (a.n === 0n) return { n: 0n, e: 0, negativeZero: negative };
  const numerator = a.n < 0n ? -a.n : a.n, denominator = b.n < 0n ? -b.n : b.n;
  let exponent = bits(numerator) - bits(denominator);
  if (exponent >= 0 ? numerator < (denominator << BigInt(exponent)) : (numerator << BigInt(-exponent)) < denominator) exponent -= 1;
  const shift = precision - 1 - exponent;
  const scaledNumerator = shift >= 0 ? numerator << BigInt(shift) : numerator;
  const scaledDenominator = shift >= 0 ? denominator : denominator << BigInt(-shift);
  let q = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if ((rc === 0 && (remainder * 2n > scaledDenominator || (remainder * 2n === scaledDenominator && (q & 1n)))) ||
      (remainder !== 0n && ((rc === 1 && negative) || (rc === 2 && !negative)))) q += 1n;
  const carry = bits(q) > precision ? 1 : 0;
  q >>= BigInt(carry);
  return { n: negative ? -q : q, e: a.e - b.e + exponent - precision + 1 + carry, negativeZero: false };
}
