import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown';

describe('renderMarkdownToHtml', () => {
  it('merges consecutive plain text lines into one paragraph', () => {
    const html = renderMarkdownToHtml([
      'This paragraph is manually wrapped around eighty characters in the source so',
      'that it stays readable while editing the markdown document in source mode.',
      'The preview should still render it as a single flowing paragraph.',
      '',
      'A blank line starts the next paragraph.',
    ].join('\n'));

    const root = document.createElement('div');
    root.innerHTML = html;

    const paragraphs = Array.from(root.querySelectorAll('p'));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe(
      'This paragraph is manually wrapped around eighty characters in the source so '
      + 'that it stays readable while editing the markdown document in source mode. '
      + 'The preview should still render it as a single flowing paragraph.',
    );
    expect(paragraphs[1].textContent).toBe('A blank line starts the next paragraph.');
  });

  it('preserves nested unordered lists based on indentation', () => {
    const html = renderMarkdownToHtml([
      '- level 1',
      '  - level 2',
      '  - level 2',
      '    - level 3',
      '  - level 2',
    ].join('\n'));

    const root = document.createElement('div');
    root.innerHTML = html;

    const topLevelItems = Array.from(root.querySelectorAll(':scope > ul > li'));
    expect(topLevelItems).toHaveLength(1);
    expect(topLevelItems[0].childNodes[0]?.textContent?.trim()).toBe('level 1');

    const secondLevelItems = Array.from(topLevelItems[0].querySelectorAll(':scope > ul > li'));
    expect(secondLevelItems).toHaveLength(3);
    expect(secondLevelItems.map((item) => item.childNodes[0]?.textContent?.trim())).toEqual([
      'level 2',
      'level 2',
      'level 2',
    ]);

    const thirdLevelItems = Array.from(secondLevelItems[1].querySelectorAll(':scope > ul > li'));
    expect(thirdLevelItems).toHaveLength(1);
    expect(thirdLevelItems[0].textContent?.trim()).toBe('level 3');
  });
});
