import {
  buildOpenInMyMindUrl,
  extractToolFilePath,
  isSupportedFileTool,
} from './myMindNavigation';

describe('myMindNavigation', () => {
  it('builds encoded URL with and without project id', () => {
    expect(buildOpenInMyMindUrl(' notes/a b.md ')).toBe('/my-mind?openFile=notes%2Fa%20b.md');
    expect(buildOpenInMyMindUrl('notes/file.md', 'p1')).toBe('/projects/p1?openFile=notes%2Ffile.md');
  });

  it('matches supported tool names case-insensitively', () => {
    expect(isSupportedFileTool('read')).toBe(true);
    expect(isSupportedFileTool(' MCP_EDIT ')).toBe(true);
    expect(isSupportedFileTool('delete')).toBe(false);
  });

  it('extracts a non-empty path from filePath or path fields', () => {
    expect(extractToolFilePath({ filePath: ' /tmp/a.md ' })).toBe('/tmp/a.md');
    expect(extractToolFilePath({ path: ' /tmp/b.md ' })).toBe('/tmp/b.md');
    expect(extractToolFilePath({ path: '   ' })).toBeNull();
    expect(extractToolFilePath({})).toBeNull();
  });
});
