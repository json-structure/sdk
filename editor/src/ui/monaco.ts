import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/language/json/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

interface MonacoWorker {
  postMessage(message: unknown): void;
  terminate(): void;
}

interface MonacoWindow extends Window {
  MonacoEnvironment?: { getWorker(moduleId: string, label: string): MonacoWorker };
}

(window as MonacoWindow).MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => label === 'json' ? new JsonWorker() : new EditorWorker()
};

export function createJsonModel(text: string): monaco.editor.ITextModel {
  return monaco.editor.createModel(text, 'json');
}

export type JsonEditorTheme = 'dark' | 'light' | 'contrast';

export function setJsonEditorTheme(theme: JsonEditorTheme): void {
  monaco.editor.setTheme(theme === 'light' ? 'vs' : theme === 'contrast' ? 'hc-black' : 'vs-dark');
}

export function createJsonEditor(element: HTMLElement, model: monaco.editor.ITextModel, theme: JsonEditorTheme = 'dark'): monaco.editor.IStandaloneCodeEditor {
  setJsonEditorTheme(theme);
  const editor = monaco.editor.create(element, {
    model,
    automaticLayout: true,
    minimap: { enabled: true },
    wordWrap: 'off',
    fontFamily: 'Consolas, "Cascadia Code", monospace',
    fontSize: 13,
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true
  });
  return editor;
}