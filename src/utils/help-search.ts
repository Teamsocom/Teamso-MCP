import type { HelpArticle } from '../types.js';
import { normalizeSearchText } from './text.js';

/**
 * Help-center search, ported from the API's `HowToMcpCatalog` so the hosted
 * and local servers rank articles the same way.
 */

/** Question words that only blur the search. Already in normalized form. */
const STOP_WORDS = new Set([
  'nasil', 'ne', 'neden', 'nerede', 'hangi', 'bir', 've', 'ile', 'mi', 'mu', 'icin', 'bu', 'su', 'da', 'de',
  'ben', 'benim', 'yapilir', 'yaparim', 'how', 'do', 'i', 'to', 'the', 'a', 'an', 'can', 'my', 'what',
  'where', 'is', 'of', 'in',
]);

/** Normalized Turkish suffixes, longest first; at least three letters of stem remain. */
const SUFFIXES = [
  'lerinin', 'larinin', 'lerini', 'larini', 'leri', 'lari', 'ilir', 'ulur', 'ilen', 'ulan', 'mesi', 'masi',
  'ler', 'lar', 'mek', 'mak', 'nin', 'nun', 'den', 'dan', 'ten', 'tan', 'dir', 'dur', 'in', 'un', 'si', 'su',
  'de', 'da', 'te', 'ta', 'ye', 'ya', 'ir', 'ur', 'ar', 'er', 'me', 'ma', 'im', 'um', 'iz', 'uz', 'e', 'a',
  'i', 'u',
];

const MAX_SUFFIX_PASSES = 3;
const OVERVIEW_PENALTY = 0.85;

/**
 * Query words folded to Turkish-insensitive form, stop words dropped and
 * inflection suffixes stripped ("girilir" → "gir", "hedefi" → "hedef").
 * Consonant softening is tolerated ("talebi" → "taleb" → "tale" also finds "talep").
 */
export function helpQueryStems(query: string): string[] {
  const stems: string[] = [];
  for (const word of normalizeSearchText(query).split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    let stem = word;
    // Suffixes stack ("dönemini" = dönem+in+i), so strip up to three times.
    for (let pass = 0; pass < MAX_SUFFIX_PASSES; pass++) {
      const before = stem;
      const suffix = SUFFIXES.find(candidate => stem.endsWith(candidate)
        && stem.length - candidate.length >= 3);
      if (suffix) stem = stem.slice(0, stem.length - suffix.length);
      if (stem === before) break;
    }
    if (stem.length >= 4 && 'bcdg'.includes(stem[stem.length - 1]!) && stem !== word) {
      stem = stem.slice(0, -1);
    }
    stems.push(stem);
  }
  return stems;
}

/**
 * Title match 10, summary 4, each body occurrence 1 (at most 3 per word), plus
 * 4 per matched word so articles covering more of the query rank first.
 * Overview articles carry the module name in their title, so they get a 15%
 * penalty to let the task article win "how do I…" questions.
 */
export function scoreHelpArticle(article: HelpArticle, stems: string[]): number {
  if (stems.length === 0) return 0;
  const title = normalizeSearchText(article.title);
  const summary = normalizeSearchText(article.summary);
  const body = normalizeSearchText(article.body);
  let total = 0;
  let matchedWords = 0;
  for (const stem of stems) {
    const score = (title.includes(stem) ? 10 : 0)
      + (summary.includes(stem) ? 4 : 0)
      + Math.min(3, occurrences(body, stem));
    if (score > 0) matchedWords++;
    total += score;
  }
  if (total === 0) return 0;
  const score = total + matchedWords * 4;
  return article.id.endsWith('.overview') ? Math.floor(score * OVERVIEW_PENALTY) : score;
}

export interface HelpSearchOptions {
  module?: string;
  role?: string;
  limit: number;
}

export interface HelpSearchHit {
  article: HelpArticle;
  score: number;
}

export function searchHelpArticles(
  articles: HelpArticle[],
  query: string,
  options: HelpSearchOptions,
): HelpSearchHit[] {
  const stems = helpQueryStems(query);
  return articles
    .filter(article => !options.module || article.dir === options.module)
    .filter(article => !options.role || (article.roles ?? []).includes(options.role))
    .map(article => ({ article, score: scoreHelpArticle(article, stems) }))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || (a.article.order ?? 0) - (b.article.order ?? 0))
    .slice(0, options.limit);
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + needle.length)) {
    count++;
  }
  return count;
}
