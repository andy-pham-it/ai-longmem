export function normalize(text: string): string {
  return text
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function trigrams(text: string): string[] {
  const s = `  ${normalize(text)} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= s.length; i += 1) out.push(s.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const A = new Set(trigrams(a));
  const B = new Set(trigrams(b));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function tokenOverlap(a: string, b: string): number {
  const toTokens = (t: string) => new Set(normalize(t).split(/[^a-z0-9]+/).filter(Boolean));
  const A = toTokens(a);
  const B = toTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.min(A.size, B.size);
}
