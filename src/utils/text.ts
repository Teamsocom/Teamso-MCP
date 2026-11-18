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

/**
 * "M. Ç.", "M.C." or "m c": two to four single letters are initials (TMS-5294, same rule as the API's
 * `SearchTextUtil`), so a person is found without typing the full name, also when privacy mode stars the names
 * ("Mi** Çe**" keeps the first letters). Returns the folded letters, or null for an ordinary query.
 */
export function initialsOf(query: string): string[] | null {
  const tokens = normalizeSearchText(query).trim().split(/[\s.]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;
  return tokens.every(token => [...token].length === 1 && /\p{L}/u.test(token)) ? tokens : null;
}

/** True when every whitespace-separated word of the query appears in one of the values. */
export function matchesAllWords(query: string, ...values: Array<string | null | undefined>): boolean {
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = values.map(normalizeSearchText).filter(Boolean).join(' ');
  const initials = initialsOf(query);
  if (initials) {
    // In order, as the first letters of the name's words (a middle name may be skipped)
    let next = 0;
    for (const word of haystack.split(/\s+/)) {
      if (next < initials.length && word.startsWith(initials[next]!)) next++;
    }
    return next === initials.length;
  }
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
