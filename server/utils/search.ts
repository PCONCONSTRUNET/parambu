const PORTUGUESE_CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'com', 'para']);

export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[m][n];
}

function singularizeToken(token: string): string {
  if (token.length >= 4 && token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenMatchesCandidate(qToken: string, normFull: string, candidateWords: string[]): boolean {
  if (normFull.includes(qToken)) return true;

  const qSingular = singularizeToken(qToken);
  if (qSingular !== qToken && normFull.includes(qSingular)) return true;

  const maxDist = qToken.length >= 7 ? 2 : qToken.length >= 4 ? 1 : 0;
  if (maxDist === 0) return false;

  for (const word of candidateWords) {
    if (Math.abs(word.length - qToken.length) <= maxDist) {
      if (damerauLevenshtein(qToken, word) <= maxDist) return true;
    }

    const wSingular = singularizeToken(word);
    if (wSingular !== word && Math.abs(wSingular.length - qSingular.length) <= maxDist) {
      if (damerauLevenshtein(qSingular, wSingular) <= maxDist) return true;
    }

    if (qToken.length >= 5 && word.length > qToken.length) {
      const prefix = word.slice(0, Math.min(word.length, qToken.length + 1));
      if (damerauLevenshtein(qToken, prefix) <= 1) return true;
    }
  }

  return false;
}

export function matchesFlexibleSearch(
  query: string,
  textFields: Array<string | null | undefined>,
  digitFields: Array<string | null | undefined> = [],
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const normFull = normalizeSearchText(textFields.filter(Boolean).join(' '));
  const rawTokens = normalizeSearchText(trimmed).split(' ').filter(Boolean);

  if (rawTokens.length === 0) {
    const qDigits = normalizeDigits(trimmed);
    if (qDigits.length === 0) return true;
    return digitFields.some((f) => f && normalizeDigits(f).includes(qDigits));
  }

  // If query is only digits/punctuation (e.g. phone or CPF fragment), allow matching digit fields cleanly
  const hasLetters = /[a-zà-ÿ]/i.test(trimmed);
  if (!hasLetters) {
    const qDigits = normalizeDigits(trimmed);
    if (qDigits.length > 0 && digitFields.some((f) => f && normalizeDigits(f).includes(qDigits))) {
      return true;
    }
  }

  const candidateWords = normFull.split(' ').filter(Boolean);
  const meaningfulTokens = rawTokens.filter((t) => !PORTUGUESE_CONNECTORS.has(t));
  const tokensToMatch = meaningfulTokens.length > 0 ? meaningfulTokens : rawTokens;

  return tokensToMatch.every((token) => {
    if (/^\d+$/.test(token) && digitFields.some((f) => f && normalizeDigits(f).includes(token))) {
      return true;
    }
    return tokenMatchesCandidate(token, normFull, candidateWords);
  });
}
