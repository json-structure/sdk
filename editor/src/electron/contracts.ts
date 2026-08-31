export interface OpenFileResult {
  path: string;
  text: string;
}

export interface SaveFileResult {
  path: string;
}

export interface FileOpenedEvent {
  path: string;
  text: string;
}

export type FileCommand = 'open' | 'save' | 'save-as';

/** Renderer-safe bridge for file workflows and opening links outside the app. */
export interface ElectronBridge {
  openFile(): Promise<OpenFileResult | null>;
  saveFile(path: string, text: string): Promise<SaveFileResult>;
  saveFileAs(text: string): Promise<SaveFileResult | null>;
  openExternal(url: string): Promise<void>;
  onFileOpened(listener: (file: FileOpenedEvent) => void): () => void;
  onFileCommand(listener: (command: FileCommand) => void): () => void;
}