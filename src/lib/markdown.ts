function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type TokenRule = {
  regex: RegExp;
  className: string;
  priority: number;
};

type TokenMatch = {
  start: number;
  end: number;
  className: string;
  priority: number;
};

const JS_KEYWORDS = [
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'of', 'package', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var',
  'void', 'while', 'with', 'yield',
];

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var',
];

const PY_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
  'with', 'yield',
];

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by',
  'order', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter',
  'drop', 'index', 'as', 'distinct', 'limit', 'offset', 'having', 'union', 'all', 'and', 'or',
  'not', 'null', 'is', 'like', 'between',
];

function keywordRegex(words: string[], caseInsensitive = false): RegExp {
  const flags = caseInsensitive ? 'gi' : 'g';
  return new RegExp(`\\b(${words.join('|')})\\b`, flags);
}

function getTokenRules(language: string): TokenRule[] {
  const normalized = language.trim().toLowerCase();

  if (normalized === 'json') {
    return [
      { regex: /\"(?:[^\"\\]|\\.)*\"\s*(?=:)/g, className: 'tok-key', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"/g, className: 'tok-string', priority: 3 },
      { regex: /\b(?:true|false|null)\b/g, className: 'tok-keyword', priority: 2 },
      { regex: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: 'tok-number', priority: 1 },
    ];
  }

  if (normalized === 'bash' || normalized === 'sh' || normalized === 'zsh' || normalized === 'shell') {
    return [
      { regex: /#.*$/gm, className: 'tok-comment', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 3 },
      { regex: /\b(?:if|then|else|fi|for|in|do|done|case|esac|while|until|function)\b/g, className: 'tok-keyword', priority: 2 },
      { regex: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, className: 'tok-variable', priority: 2 },
      { regex: /\b\d+\b/g, className: 'tok-number', priority: 1 },
    ];
  }

  if (normalized === 'go' || normalized === 'golang') {
    return [
      { regex: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, className: 'tok-comment', priority: 5 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|`[\s\S]*?`|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 4 },
      { regex: keywordRegex(GO_KEYWORDS), className: 'tok-keyword', priority: 3 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
      { regex: /\b[A-Z][A-Za-z0-9_]*\b/g, className: 'tok-type', priority: 1 },
    ];
  }

  if (normalized === 'py' || normalized === 'python') {
    return [
      { regex: /#.*$/gm, className: 'tok-comment', priority: 5 },
      { regex: /\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?'''|\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 4 },
      { regex: keywordRegex(PY_KEYWORDS), className: 'tok-keyword', priority: 3 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
      { regex: /\bself\b/g, className: 'tok-variable', priority: 1 },
    ];
  }

  if (normalized === 'sql') {
    return [
      { regex: /--.*$/gm, className: 'tok-comment', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 3 },
      { regex: keywordRegex(SQL_KEYWORDS, true), className: 'tok-keyword', priority: 2 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 1 },
    ];
  }

  return [
    { regex: /\/\*[\s\S]*?\*\/|\/\/.*$|#.*$/gm, className: 'tok-comment', priority: 5 },
    { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, className: 'tok-string', priority: 4 },
    { regex: keywordRegex(JS_KEYWORDS), className: 'tok-keyword', priority: 3 },
    { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
    { regex: /\b[A-Z][A-Za-z0-9_]*\b/g, className: 'tok-type', priority: 1 },
  ];
}

function findMatches(code: string, rules: TokenRule[]): TokenMatch[] {
  const matches: TokenMatch[] = [];

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match = rule.regex.exec(code);
    while (match) {
      const value = match[0];
      if (value.length > 0) {
        matches.push({
          start: match.index,
          end: match.index + value.length,
          className: rule.className,
          priority: rule.priority,
        });
      }
      match = rule.regex.exec(code);
    }
  }

  matches.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return (b.end - b.start) - (a.end - a.start);
  });

  return matches;
}

function highlightCode(code: string, language: string): string {
  const matches = findMatches(code, getTokenRules(language));
  const byStart = new Map<number, TokenMatch[]>();
  for (const match of matches) {
    const list = byStart.get(match.start);
    if (list) {
      list.push(match);
    } else {
      byStart.set(match.start, [match]);
    }
  }

  let index = 0;
  let html = '';

  while (index < code.length) {
    const candidates = byStart.get(index) || [];
    let selected: TokenMatch | null = null;
    for (const candidate of candidates) {
      if (!selected) {
        selected = candidate;
        continue;
      }
      if (candidate.priority > selected.priority) {
        selected = candidate;
        continue;
      }
      if (candidate.priority === selected.priority && candidate.end - candidate.start > selected.end - selected.start) {
        selected = candidate;
      }
    }

    if (selected && selected.end > index) {
      html += `<span class=\"${selected.className}\">${escapeHtml(code.slice(index, selected.end))}</span>`;
      index = selected.end;
      continue;
    }

    html += escapeHtml(code[index]);
    index += 1;
  }

  return html;
}

function renderInlineMarkdown(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" rel="noreferrer noopener" target="_blank">$1</a>');
  return text;
}

function parseTableCells(line: string): string[] | null {
  if (!line.includes('|')) {
    return null;
  }

  let value = line.trim();
  if (value.startsWith('|')) {
    value = value.slice(1);
  }
  if (value.endsWith('|')) {
    value = value.slice(0, -1);
  }

  const cells = value.split('|').map((cell) => cell.trim());
  return cells.length > 0 ? cells : null;
}

function isTableSeparator(line: string, expectedCells: number): boolean {
  const cells = parseTableCells(line);
  if (!cells || cells.length !== expectedCells) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeFence = false;
  let inTable = false;
  let tableColumns = 0;
  let codeLanguage = '';
  let codeFenceLines: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  const closeCodeFence = () => {
    if (!inCodeFence) {
      return;
    }
    const langClass = codeLanguage ? ` language-${escapeHtml(codeLanguage)}` : '';
    const highlighted = highlightCode(codeFenceLines.join('\n'), codeLanguage);
    html.push(`<pre class=\"md-code-block\"><code class=\"${langClass.trim()}\">${highlighted}</code></pre>`);
    inCodeFence = false;
    codeLanguage = '';
    codeFenceLines = [];
  };

  const closeTable = () => {
    if (inTable) {
      html.push('</tbody></table>');
      inTable = false;
      tableColumns = 0;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^```\s*([a-zA-Z0-9_+-]+)?\s*$/.exec(line);
    if (fenceMatch) {
      closeList();
      closeTable();
      if (!inCodeFence) {
        inCodeFence = true;
        codeLanguage = (fenceMatch[1] || '').toLowerCase();
        codeFenceLines = [];
      } else {
        closeCodeFence();
      }
      continue;
    }

    if (inCodeFence) {
      codeFenceLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      closeList();
      closeTable();
      continue;
    }

    if (!inTable) {
      const headerCells = parseTableCells(trimmed);
      if (headerCells && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim(), headerCells.length)) {
        closeList();
        inTable = true;
        tableColumns = headerCells.length;
        html.push('<table class="md-table"><thead><tr>');
        for (const cell of headerCells) {
          html.push(`<th>${renderInlineMarkdown(cell)}</th>`);
        }
        html.push('</tr></thead><tbody>');
        index += 1;
        continue;
      }
    }

    if (inTable) {
      const rowCells = parseTableCells(trimmed);
      if (rowCells) {
        const normalizedCells = [...rowCells];
        while (normalizedCells.length < tableColumns) {
          normalizedCells.push('');
        }
        normalizedCells.length = tableColumns;
        html.push('<tr>');
        for (const cell of normalizedCells) {
          html.push(`<td>${renderInlineMarkdown(cell)}</td>`);
        }
        html.push('</tr>');
        continue;
      }
      closeTable();
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/.exec(trimmed);
    if (quoteMatch) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  closeCodeFence();
  closeList();
  closeTable();

  return html.join('\n');
}
