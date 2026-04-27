export function buildOpenInMyMindUrl(path: string, projectId?: string): string {
  const trimmedPath = path.trim();
  const baseUrl = projectId ? `/projects/${projectId}` : '/my-mind';
  return `${baseUrl}?openFile=${encodeURIComponent(trimmedPath)}`;
}

export function isSupportedFileTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === 'read' || normalized === 'write' || normalized === 'edit' || normalized === 'replace_lines' ||
         normalized === 'insert_lines' || normalized === 'mcp_read' || normalized === 'mcp_write' || normalized === 'mcp_edit';
}

export function extractToolFilePath(input: Record<string, unknown>): string | null {
  const value = input.filePath || input.path;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
