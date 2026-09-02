import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * UI colour comes from the tokens in `styles/globals.css`, not from hex
 * literals in components.
 *
 * Sixty-odd copies of `#f8fafc` accumulated across seventeen files while the
 * token that means the same thing, `--text-primary`, sat unused next to them.
 * A literal is a colour nobody can re-theme, audit for contrast, or find when
 * the palette changes; the fifth one typed from memory is also the first one
 * typed wrong. CLAUDE.md says "tokens, not hex", and this is the test that
 * makes the rule cost something to break.
 *
 * The allow-list is deliberately explicit and per-file: every entry names the
 * reason a token cannot serve, and an entry whose literal has since gone is a
 * failure too, so the list cannot rot into a blanket exemption.
 */

const WEB = fileURLToPath(new URL('..', import.meta.url));
const ROOTS = ['app', 'components'];

/** Literals that cannot be a token, each with the reason it stays. */
const ALLOWED: Array<{ file: string; literal: string; why: string }> = [
  {
    file: 'app/layout.tsx',
    literal: '#0a0d14',
    why:
      '<meta name="theme-color"> is read by the browser chrome before any ' +
      'stylesheet loads; its content attribute cannot reference a CSS ' +
      'variable. The value mirrors --bg-main, pinned below.',
  },
  {
    file: 'app/cashflow/CashFlowView.tsx',
    literal: '#ec4899',
    why:
      'The fifth spend-category colour. Cyan, caution, indigo and muted are ' +
      'taken by the other four categories, and this pink has no second use ' +
      'anywhere to justify a token of its own.',
  },
];

/**
 * Colours the allow-listed literals are meant to equal. If somebody changes
 * the token but not the literal (or the reverse), the two drift apart and the
 * browser chrome stops matching the page.
 */
const MIRRORS: Array<{ literal: string; token: string }> = [{ literal: '#0a0d14', token: '--bg-main' }];

/**
 * A `#` followed by 3-8 hex digits and then a word boundary. `Ref #{...}` and
 * `#1104` inside a vendor string do not appear in component code; if one ever
 * does, it belongs on the allow-list with that explanation, not in a looser
 * regex that would then miss real colours.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const TOKEN_USE = /var\((--[a-z0-9-]+)\)/g;
const TOKEN_DEF = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;

function tsxFilesIn(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesIn(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const componentFiles = ROOTS.flatMap((root) => tsxFilesIn(join(WEB, root)))
  .filter((file) => !file.endsWith('.test.tsx'))
  .sort();

const sources = componentFiles.map((file) => ({
  file: relative(WEB, file),
  text: readFileSync(file, 'utf8'),
}));

const globals = readFileSync(join(WEB, 'styles/globals.css'), 'utf8');
const definedTokens = new Map<string, string>();
for (const match of globals.matchAll(TOKEN_DEF)) definedTokens.set(match[1], match[2].trim());

describe('design tokens', () => {
  it('found the component tree, so this test is not silently checking nothing', () => {
    expect(sources.length).toBeGreaterThan(8);
    expect(definedTokens.size).toBeGreaterThan(8);
  });

  it('is the only place a hex colour literal appears outside the allow-list', () => {
    const offending = sources.flatMap(({ file, text }) =>
      [...text.matchAll(HEX)]
        .map((match) => match[0])
        .filter(
          (literal) =>
            !ALLOWED.some((entry) => entry.file === file && entry.literal.toLowerCase() === literal.toLowerCase())
        )
        .map((literal) => `${file}: ${literal}`)
    );

    expect(offending).toEqual([]);
  });

  it('still needs every allow-list entry, so the list cannot rot', () => {
    const stale = ALLOWED.filter(({ file, literal }) => {
      const source = sources.find((entry) => entry.file === file);
      return !source || !source.text.toLowerCase().includes(literal.toLowerCase());
    }).map(({ file, literal }) => `${file}: ${literal}`);

    expect(stale).toEqual([]);
  });

  it('keeps each allow-listed literal equal to the token it mirrors', () => {
    for (const { literal, token } of MIRRORS) {
      expect(definedTokens.get(token)?.toLowerCase()).toBe(literal.toLowerCase());
    }
  });

  it('only references tokens globals.css defines', () => {
    // `var(--text-brigth)` is not an error anywhere: the browser treats an
    // undefined custom property as `unset`, and the text quietly inherits
    // whatever colour its parent had.
    const undefinedUses = sources.flatMap(({ file, text }) =>
      [...text.matchAll(TOKEN_USE)]
        .map((match) => match[1])
        .filter((token) => !definedTokens.has(token))
        .map((token) => `${file}: ${token}`)
    );

    expect(undefinedUses).toEqual([]);
  });
});
