import assert from 'node:assert/strict';
import test from 'node:test';
import {
  helpQueryStems,
  scoreHelpArticle,
  searchHelpArticles,
} from '../dist/utils/help-search.js';
import { htmlToText, matchesAllWords, normalizeSearchText } from '../dist/utils/text.js';
import { HELP_BUNDLE } from './helpers.mjs';

test('normalizeSearchText folds Turkish letters like the API', () => {
  assert.equal(normalizeSearchText('İSMAİL Işık Öztürk ŞULE ÇAĞ'), 'ismail isik ozturk sule cag');
  assert.equal(normalizeSearchText('Intel'), 'intel');
  assert.equal(normalizeSearchText(undefined), '');
});

test('helpQueryStems drops stop words and strips Turkish suffixes', () => {
  assert.deepEqual(helpQueryStems('Performans hedefi nasıl girilir?'), ['performans', 'hedef', 'gir']);
  assert.deepEqual(helpQueryStems('dönemini kapatırım'), ['donem', 'kapat']);
  // Consonant softening: "talebi" → "taleb" → "tale", which also matches "talep".
  assert.deepEqual(helpQueryStems('izin talebi'), ['izin', 'tale']);
  // English words lose a trailing vowel too; the stems still match the full words.
  assert.deepEqual(helpQueryStems('How do I approve a leave'), ['approv', 'leav']);
});

test('scoreHelpArticle weighs title, summary and body, and penalises overviews', () => {
  const article = {
    id: 'leave.request',
    dir: 'leave',
    title: 'İzin talebi oluşturma',
    summary: 'Yıllık izin talebi.',
    body: 'izin izin izin izin',
  };
  // izin: title 10 + summary 4 + body min(3, 4) = 17; tale: 10 + 4 = 14; two matched words: +8.
  assert.equal(scoreHelpArticle(article, ['izin', 'tale']), 39);
  assert.equal(scoreHelpArticle({ ...article, id: 'leave.overview' }, ['izin', 'tale']), 33);
  assert.equal(scoreHelpArticle(article, ['bordro']), 0);
  assert.equal(scoreHelpArticle(article, []), 0);
});

test('searchHelpArticles filters, ranks and limits', () => {
  const hits = searchHelpArticles(HELP_BUNDLE.articles, 'hedef girişi', { limit: 5 });
  assert.deepEqual(hits.map(hit => hit.article.id), ['performance.goal-entry-employee', 'performance.overview']);
  assert.deepEqual(searchHelpArticles(HELP_BUNDLE.articles, 'hedef', { limit: 1 }).length, 1);
  assert.deepEqual(searchHelpArticles(HELP_BUNDLE.articles, 'izin', { module: 'performance', limit: 5 }), []);
});

test('matchesAllWords and htmlToText', () => {
  assert.equal(matchesAllWords('ozturk can', 'Can Öztürk'), true);
  assert.equal(matchesAllWords('can kaya', 'Can Öztürk'), false);
  assert.equal(matchesAllWords('  ', 'anything'), true);
  assert.equal(htmlToText('<p>A&nbsp;<i>b</i></p><br/>c &lt;d&gt;'), 'A b\nc <d>');
});
