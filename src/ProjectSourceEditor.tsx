import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { tags as t } from '@lezer/highlight';
import { getProjectSourceLanguage, type ProjectSourceLanguage, type SourceEditorSelection } from './projectSourceSelection';

type ProjectSourceEditorProps = {
  path: string;
  value: string;
  disabled: boolean;
  themeMode: 'dark' | 'light';
  onChange: (value: string) => void;
  onSelectionChange: (selection: SourceEditorSelection | null) => void;
};

const CODE_EDITOR_FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const codeEditorDarkTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#15171c',
    color: '#d9deea',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    backgroundColor: '#15171c',
    fontFamily: CODE_EDITOR_FONT_FAMILY,
    lineHeight: '1.5',
  },
  '.cm-content': {
    backgroundColor: '#15171c',
    minHeight: '100%',
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 14px',
  },
  '.cm-gutters': {
    backgroundColor: '#101318',
    borderRight: '1px solid #2b3342',
    color: '#6f7b90',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '38px',
    padding: '0 10px 0 8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(109, 144, 255, 0.08)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(109, 144, 255, 0.12)',
    color: '#dbe4ff',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(109, 144, 255, 0.35)',
  },
  '.cm-cursor': {
    borderLeftColor: '#f6f8ff',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(126, 188, 255, 0.18)',
    outline: '1px solid rgba(126, 188, 255, 0.45)',
  },
}, { dark: true });

const codeEditorLightTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#f8fbff',
    color: '#132238',
    fontSize: '13px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    backgroundColor: '#f8fbff',
    fontFamily: CODE_EDITOR_FONT_FAMILY,
    lineHeight: '1.5',
  },
  '.cm-content': {
    backgroundColor: '#f8fbff',
    minHeight: '100%',
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 14px',
  },
  '.cm-gutters': {
    backgroundColor: '#eef3fb',
    borderRight: '1px solid #d5dfef',
    color: '#62708a',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '38px',
    padding: '0 10px 0 8px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(45, 104, 224, 0.08)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(45, 104, 224, 0.12)',
    color: '#0b57d0',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(45, 104, 224, 0.24)',
  },
  '.cm-cursor': {
    borderLeftColor: '#132238',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(11, 87, 208, 0.12)',
    outline: '1px solid rgba(11, 87, 208, 0.35)',
  },
}, { dark: false });

const codeEditorDarkHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: '#7ab7ff' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a5e075' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#f3a86a' },
  { tag: [t.comment, t.docComment], color: '#7f8a9c', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.definition(t.typeName)], color: '#d9a8ff' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#ffd166' },
  { tag: [t.propertyName, t.attributeName], color: '#57c1d6' },
  { tag: [t.variableName, t.self], color: '#d9deea' },
  { tag: [t.operator, t.punctuation], color: '#aab4c8' },
  { tag: [t.invalid], color: '#ff8a8a' },
]);

const codeEditorLightHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: '#0b57d0' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#0f7a43' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#b65e17' },
  { tag: [t.comment, t.docComment], color: '#61708a', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.definition(t.typeName)], color: '#6f42c1' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#875200' },
  { tag: [t.propertyName, t.attributeName], color: '#0b7285' },
  { tag: [t.variableName, t.self], color: '#132238' },
  { tag: [t.operator, t.punctuation], color: '#4d5b70' },
  { tag: [t.invalid], color: '#b42318' },
]);

function codeMirrorLanguageExtensions(path: string, language: ProjectSourceLanguage): Extension[] {
  const lowerPath = path.toLowerCase();
  switch (language) {
    case 'javascript':
      return [javascript({ jsx: lowerPath.endsWith('.jsx') })];
    case 'typescript':
      return [javascript({ typescript: true, jsx: lowerPath.endsWith('.tsx') })];
    case 'go':
      return [go()];
    case 'python':
      return [python()];
    case 'ruby':
      return [StreamLanguage.define(ruby)];
    case 'json':
      return [javascript()];
    default:
      return [];
  }
}

function ProjectSourceEditor({
  path,
  value,
  disabled,
  themeMode,
  onChange,
  onSelectionChange,
}: ProjectSourceEditorProps): ReactElement {
  const language = useMemo(() => getProjectSourceLanguage(path), [path]);
  const extensions = useMemo(() => {
    const themeExtension = themeMode === 'light' ? codeEditorLightTheme : codeEditorDarkTheme;
    const highlightExtension = syntaxHighlighting(
      themeMode === 'light' ? codeEditorLightHighlightStyle : codeEditorDarkHighlightStyle,
      { fallback: true },
    );
    return [
      themeExtension,
      highlightExtension,
      ...codeMirrorLanguageExtensions(path, language),
    ];
  }, [language, path, themeMode]);

  const handleUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (!viewUpdate.docChanged && !viewUpdate.selectionSet) return;
    const selection = viewUpdate.state.selection.main;
    if (selection.empty) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({ start: selection.from, end: selection.to });
  }, [onSelectionChange]);

  return (
    <CodeMirror
      className={`mind-code-editor ${disabled ? 'mind-code-editor-disabled' : ''}`}
      value={value}
      height="100%"
      basicSetup={true}
      indentWithTab={true}
      editable={!disabled}
      readOnly={disabled}
      theme={themeMode}
      extensions={extensions}
      onChange={onChange}
      onUpdate={handleUpdate}
      aria-label={`Edit ${path}`}
    />
  );
}

export default ProjectSourceEditor;
