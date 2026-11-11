/**
 * @fileoverview Unit tests for the shared HTML-to-text helper
 */

import { describe, expect, it } from 'vitest';
import { htmlToText } from '../html-to-text.js';

describe('htmlToText', () => {
  it('returns an empty string for empty, null or non-string input', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(42)).toBe('');
  });

  it('turns paragraphs into blank-line separated blocks', () => {
    expect(htmlToText('<p>First.</p><p>Second.</p>')).toBe('First.\n\nSecond.');
  });

  it('turns <br> into line breaks', () => {
    expect(htmlToText('Line one<br>Line two<br />Line three')).toBe(
      'Line one\nLine two\nLine three',
    );
  });

  it('renders headings as markdown headings', () => {
    expect(htmlToText('<h2>Aura of Selune</h2><p>Moonlight.</p>')).toBe(
      '## Aura of Selune\n\nMoonlight.',
    );
  });

  it('renders list items as bullets', () => {
    expect(htmlToText('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two');
  });

  it('keeps a paragraph inside a list item on the bullet line (Foundry editor output)', () => {
    expect(htmlToText('<ul><li><p>One</p></li><li><p>Two</p></li></ul><p>After</p>')).toBe(
      '- One\n- Two\n\nAfter',
    );
  });

  it('keeps a bare < or > that is not part of a tag', () => {
    expect(htmlToText('<p>3 < 5 and 7 > 2</p>')).toBe('3 < 5 and 7 > 2');
  });

  it('keeps bold text as markdown bold', () => {
    expect(htmlToText('<p><strong>Cost.</strong> 1 action</p>')).toBe('**Cost.** 1 action');
  });

  it('renders table rows on their own lines with cells separated', () => {
    expect(
      htmlToText(
        '<table><tr><th>d6</th><th>Effect</th></tr><tr><td>1</td><td>Fire</td></tr></table>',
      ),
    ).toBe('d6 | Effect\n1 | Fire');
  });

  it('decodes named and numeric entities', () => {
    expect(htmlToText('Salt &amp; pepper &lt;3 &quot;x&quot; &#39;y&#39; &#8212; &#x2019;')).toBe(
      'Salt & pepper <3 "x" \'y\' — ’',
    );
    expect(htmlToText('a&nbsp;b &ndash; c &hellip;')).toBe('a b – c …');
  });

  it('does not double-decode an escaped entity', () => {
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });

  it('keeps unknown entities as written', () => {
    expect(htmlToText('&bogus; ok')).toBe('&bogus; ok');
  });

  it('replaces Foundry content links with their label', () => {
    expect(
      htmlToText(
        'See @UUID[Compendium.dnd5e.rules.JournalEntry.abc]{Grappled} and @Compendium[dnd5e.items.xyz]{Rope}.',
      ),
    ).toBe('See Grappled and Rope.');
  });

  it('keeps the target of a content link without a label', () => {
    expect(htmlToText('@UUID[Actor.abc123]')).toBe('Actor.abc123');
  });

  it('uses the name of a legacy name-based link without a label', () => {
    expect(htmlToText('Cast @Compendium[dnd5e.spells.Fireball].')).toBe('Cast Fireball.');
    expect(htmlToText('@Compendium[dnd5e.spells.Item.abcdefgh12345678]')).toBe(
      'dnd5e.spells.Item.abcdefgh12345678',
    );
  });

  it('replaces inline rolls with their formula or label', () => {
    expect(htmlToText('Deals [[/r 2d6 + 3]] damage or [[/damage 1d8 fire]]{a burst}.')).toBe(
      'Deals 2d6 + 3 damage or a burst.',
    );
    expect(htmlToText('Roll [[1d4]].')).toBe('Roll 1d4.');
  });

  it('drops script and style contents', () => {
    expect(htmlToText('<style>p{}</style><p>Text</p><script>alert(1)</script>')).toBe('Text');
  });

  it('collapses runs of whitespace and blank lines', () => {
    expect(htmlToText('<p>  Lots   of\n   space  </p>\n\n\n<p></p><p>End</p>')).toBe(
      'Lots of space\n\nEnd',
    );
  });

  it('leaves plain text untouched', () => {
    expect(htmlToText('Just text.')).toBe('Just text.');
  });
});
