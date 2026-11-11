/**
 * @fileoverview Converts stored FoundryVTT HTML (item, journal and actor
 * descriptions) into readable plain text with light markdown.
 *
 * FoundryVTT stores rich text as HTML, sprinkled with its own enricher syntax:
 * content links (`@UUID[...]{Label}`) and inline rolls (`[[/r 1d6]]`). This
 * keeps the structure a reader needs — paragraphs, headings, list items, table
 * rows, line breaks — and drops the rest. It is a formatter, not a sanitizer:
 * the output is plain text for an LLM, never rendered back as HTML.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  divide: '÷',
  minus: '−',
  plusmn: '±',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Decodes HTML entities in one pass, so `&amp;lt;` becomes `&lt;`, not `<`. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Replaces Foundry enricher syntax with the text a reader would see. */
function replaceEnrichers(text: string): string {
  return (
    text
      // Inline rolls: [[/r 1d6]]{label}, [[/damage 2d6 fire]], [[1d4]]
      .replace(/\[\[(?:\/[a-z]+\s+)?([^\]]*?)\]\](?:\{([^}]*)\})?/gi, (_m, formula, label) =>
        (label ?? formula).trim(),
      )
      // Content links: @UUID[...]{Label}, @Compendium[...]{Label}, @Check[...]
      .replace(/@[A-Za-z]+\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, target, label) =>
        (label ?? target).trim(),
      )
  );
}

/**
 * Converts a stored HTML string to plain text. Non-string input (a missing or
 * null field) yields an empty string, so callers can pass a raw `system` value.
 */
export function htmlToText(html: unknown): string {
  if (typeof html !== 'string' || html === '') {
    return '';
  }

  let text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Source newlines are not meaningful in HTML; structure comes from tags.
    .replace(/\s*\n\s*/g, ' ')
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|blockquote|ul|ol|table|aside|figure)>/gi, '\n\n')
    .replace(/<(p|div|section|blockquote|ul|ol|table|aside|figure)\b[^>]*>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>\s*(?=<t[dh]\b)/gi, ' | ')
    .replace(/<\/?(strong|b)\b[^>]*>/gi, '**')
    .replace(/<hr\s*\/?>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(replaceEnrichers(text));

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
