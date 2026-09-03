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

/** Thresholds used to keep Monaco responsive for large structured documents. */
export const MONACO_PERFORMANCE_LIMITS = Object.freeze({
  largeDocumentBytes: 256_000,
  largeDocumentLines: 4_000,
  maxTokenizationLineLength: 20_000
});

export function createJsonModel(text: string, uri?: string): monaco.editor.ITextModel {
  return monaco.editor.createModel(text, 'json', uri === undefined ? undefined : monaco.Uri.parse(uri));
}

/** Updates a model only when its source has changed, avoiding redundant tokenization. */
export function updateJsonModel(model: monaco.editor.ITextModel, text: string): void {
  if (model.isDisposed() || model.getValueLength() === text.length && model.getValue() === text) return;
  model.setValue(text);
}

/** Releases a JSON model and its worker-side tokenization state. */
export function disposeJsonModel(model: monaco.editor.ITextModel): void {
  if (!model.isDisposed()) model.dispose();
}

export type JsonEditorTheme = 'dark' | 'light' | 'contrast';

export function setJsonEditorTheme(theme: JsonEditorTheme): void {
  monaco.editor.setTheme(theme === 'light' ? 'vs' : theme === 'contrast' ? 'hc-black' : 'vs-dark');
}

export function createJsonEditor(element: HTMLElement, model: monaco.editor.ITextModel, theme: JsonEditorTheme = 'dark'): monaco.editor.IStandaloneCodeEditor {
  setJsonEditorTheme(theme);
  const largeDocument = model.getValueLength() >= MONACO_PERFORMANCE_LIMITS.largeDocumentBytes ||
    model.getLineCount() >= MONACO_PERFORMANCE_LIMITS.largeDocumentLines;
  const editor = monaco.editor.create(element, {
    model,
    automaticLayout: true,
    largeFileOptimizations: true,
    maxTokenizationLineLength: MONACO_PERFORMANCE_LIMITS.maxTokenizationLineLength,
    minimap: { enabled: !largeDocument },
    wordWrap: 'off',
    fontFamily: 'Consolas, "Cascadia Code", monospace',
    fontSize: 13,
    scrollBeyondLastLine: false,
    smoothScrolling: false,
    tabSize: 2,
    insertSpaces: true
  });
  return editor;
}
