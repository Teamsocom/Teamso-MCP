import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamsoClient } from '../client.js';
import type { HelpArticle, HelpLanguage } from '../types.js';
import { codeList } from '../utils/format.js';
import { searchHelpArticles } from '../utils/help-search.js';
import { errorResult, toolResult } from '../utils/results.js';
import {
  HELP_RESOURCE_PREFIX,
  absoluteHelpUrl,
  toHelpArticleSummary,
} from '../utils/structured.js';
import {
  helpArticleOutputSchema,
  helpModulesOutputSchema,
  helpSearchOutputSchema,
} from './schemas.js';
import { READ_ONLY } from './shared.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const UNAVAILABLE = 'The Teamso help articles could not be loaded right now. Try again in a minute.';

const langSchema = z.enum(['tr', 'en']).default('tr')
  .describe('Article language: `tr` (default) or `en`.');

export function registerSearchHelpArticles(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'search_help_articles',
    {
      title: 'Search Teamso help articles',
      description: 'Search the Teamso user guides (help center: leave, performance, payroll, time '
        + 'tracking and every other module). Call this first when the user asks how to do '
        + 'something in Teamso, then read the best match with `get_help_article` and explain '
        + 'the steps, citing its `url`.',
      inputSchema: {
        query: z.string().trim().min(1).max(300)
          .describe('Question or keywords, e.g. "performans hedefi nasıl girilir" or "approve a leave request".'),
        lang: langSchema,
        module: z.string().trim().min(1).max(60).optional()
          .describe('Only this module folder, e.g. `performance`, `leave`, `payroll` (see `list_help_modules`).'),
        role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE']).optional()
          .describe('Only articles written for this role.'),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT)
          .describe(`Maximum results (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`),
      },
      outputSchema: helpSearchOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ query, lang, module, role, limit }) => {
      const bundle = await loadBundle(client, lang);
      if (!bundle) return errorResult(UNAVAILABLE);

      const origin = siteOrigin(client);
      const hits = searchHelpArticles(bundle.articles, query, { module, role, limit });
      const results = hits.map(hit => ({
        ...toHelpArticleSummary(hit.article, lang, origin),
        score: hit.score,
      }));

      if (results.length === 0) {
        return toolResult(
          `No help article matched "${query}". Try other words, or browse with \`list_help_modules\`.`,
          { lang, query, results },
        );
      }

      const lines = results.map(result => `- **${result.title}** (\`${result.id}\`): ${result.summary} ${result.url}`);
      return toolResult(
        `## Help articles for "${query}"\n\n${lines.join('\n')}\n\nRead one with \`get_help_article\`.`,
        {
          lang,
          query,
          results,
          nextAction: {
            tool: 'get_help_article',
            arguments: { id: results[0]!.id, lang },
            reason: 'Read the best match before answering, and cite its url.',
          },
        },
      );
    },
  );
}

export function registerGetHelpArticle(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'get_help_article',
    {
      title: 'Read a Teamso help article',
      description: 'Return one Teamso help article as Markdown: steps, common problems and related '
        + 'articles. Get the `id` from `search_help_articles` or `list_help_modules`.',
      inputSchema: {
        id: z.string().trim().min(3).max(120)
          .describe('Article id `<module>.<article>`, e.g. `performance.goal-entry-employee`.'),
        lang: langSchema,
      },
      outputSchema: helpArticleOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ id, lang }) => {
      const bundle = await loadBundle(client, lang);
      if (!bundle) return errorResult(UNAVAILABLE);

      const article = bundle.articles.find(candidate => candidate.id === id);
      if (!article) {
        return errorResult(`No help article \`${id}\` exists in \`${lang}\`. `
          + 'Find the id with `search_help_articles` or `list_help_modules`.');
      }

      const origin = siteOrigin(client);
      const summary = toHelpArticleSummary(article, lang, origin);
      return toolResult(articleMarkdown(article, lang, origin), {
        lang,
        article: {
          ...summary,
          ...(article.verified ? { verified: article.verified } : {}),
          routes: article.routes ?? [],
          related: article.related ?? [],
        },
      });
    },
  );
}

export function registerListHelpModules(server: McpServer, client: TeamsoClient): void {
  server.registerTool(
    'list_help_modules',
    {
      title: 'List Teamso help modules',
      description: 'List the Teamso modules that have user guides, with each module\'s article '
        + 'titles and ids. Use it to browse when a search finds nothing.',
      inputSchema: {
        lang: langSchema,
      },
      outputSchema: helpModulesOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ lang }) => {
      const bundle = await loadBundle(client, lang);
      if (!bundle) return errorResult(UNAVAILABLE);

      const byId = new Map(bundle.articles.map(article => [article.id, article]));
      const modules = bundle.modules
        .map(module => ({
          dir: module.dir,
          title: module.title,
          ...(module.description ? { description: module.description } : {}),
          articles: (module.articles ?? [])
            .map(articleId => byId.get(articleId))
            .filter((article): article is HelpArticle => Boolean(article))
            .map(article => ({ id: article.id, title: article.title })),
        }))
        .filter(module => module.articles.length > 0);

      const text = modules
        .map(module => [
          `## ${module.title} (\`${module.dir}\`)`,
          ...module.articles.map(article => `- ${article.title} (\`${article.id}\`)`),
        ].join('\n'))
        .join('\n\n');
      return toolResult(text || 'No help modules are published yet.', { lang, modules });
    },
  );
}

async function loadBundle(client: TeamsoClient, lang: HelpLanguage) {
  try {
    return await client.getHelpBundle(lang);
  } catch {
    return undefined;
  }
}

function siteOrigin(client: TeamsoClient): string {
  try {
    return new URL(client.helpBaseUrl).origin;
  } catch {
    return client.helpBaseUrl;
  }
}

/** Full article text with absolute image links and `teamso://how-to/` article links. */
function articleMarkdown(article: HelpArticle, lang: HelpLanguage, origin: string): string {
  const articleLang = article.lang ?? lang;
  const body = (article.body ?? '')
    .replace(/\]\((\/how-to\/[^)\s]+)\)/g, `](${origin}$1)`)
    .replace(/\]\(how-to:([a-z0-9.-]+)\)/g, `](${HELP_RESOURCE_PREFIX}${articleLang}/$1)`)
    .trim();

  const lines = [
    `# ${article.title}`,
    '',
    article.summary ?? '',
    '',
    `- Id: \`${article.id}\``,
    `- Roles: ${(article.roles ?? []).join(', ') || '—'}`,
  ];
  if (article.routes?.length) lines.push(`- Screens: ${article.routes.join(', ')}`);
  lines.push(`- Source: ${absoluteHelpUrl(article, origin)}`);
  if (article.verified) lines.push(`- Last verified: ${article.verified}`);
  lines.push('', body);
  if (article.related?.length) {
    lines.push('', '## Related article ids', '', codeList(article.related));
  }
  return lines.join('\n');
}
