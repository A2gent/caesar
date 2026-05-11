import { describe, expect, it } from 'vitest';
import { renderMarkdownToHtml } from './markdown';

describe('renderMarkdownToHtml', () => {
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
