/** Small Markdown helpers for the human-readable half of tool results. */

export function markdownTable(headers: string[], rows: Array<Array<string | number | boolean | undefined | null>>): string {
  const head = `| ${headers.map(escapeCell).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(row => `| ${row.map(cell => escapeCell(cell)).join(' | ')} |`);
  return [head, divider, ...body].join('\n');
}

export function escapeCell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** "1 day", "2.5 days". */
export function formatDays(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
}

export function formatDateRange(start: string | undefined, end: string | undefined): string {
  if (start && end) return `${start} → ${end}`;
  return start ?? end ?? '—';
}

export function codeList(values: string[]): string {
  return values.length ? values.map(value => `\`${value}\``).join(', ') : '—';
}
