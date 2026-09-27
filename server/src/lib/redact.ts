/**
 * Redaction for diagnostics, logs and support reports (Q17, V18, V20).
 * Removes values of secret-looking keys and secret-looking patterns inside strings.
 */
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|card|cvv|cvc|pan|account[-_]?number|private[-_]?key|signature|credential)/i;

const PATTERNS: [RegExp, string][] = [
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED-NUMBER]'],                         // card-like numbers
  [/\b(sk|pk|rk|sq0[a-z]{3}|EAAA)[-_A-Za-z0-9]{12,}\b/g, '[REDACTED-KEY]'],   // provider API key shapes
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@'],               // DB passwords in URLs
  [/([?&](?:token|key|secret|signature|t)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED-LONG-TOKEN]'],                        // long opaque tokens
];

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact<T>(v: T, depth = 0): T {
  if (depth > 8) return '[…]' as unknown as T;
  if (typeof v === 'string') return redactString(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(val, depth + 1);
    }
    return out as T;
  }
  return v;
}
