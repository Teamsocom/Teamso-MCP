/**
 * Case- and diacritic-insensitive folding for Turkish text, matching the API's
 * `SearchTextUtil.normalize`: I/İ/ı collapse onto "i" and every other accent
 * (ş, ç, ğ, ö, ü) is stripped, so "ozturk" finds "Öztürk".
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[ıI]/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** True when every whitespace-separated word of the query appears in one of the values. */
export function matchesAllWords(query: string, ...values: Array<string | null | undefined>): boolean {
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = values.map(normalizeSearchText).filter(Boolean).join(' ');
  return words.every(word => haystack.includes(word));
}

/** Plain text from the HTML the announcement editor stores. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
