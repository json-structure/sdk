import type { ConversionRequest, ConversionResult, ConversionSource, LibraryOperation, OpenGeneratedOutputRequest, OpenGeneratedOutputResult, ProgressEvent, SelectConversionSourceRequest } from '../contracts';
import type { ConversionCommandsManifest } from '../conversion/types';
import type { LibraryDocument, LibraryEntry } from '../libraries/contracts';

export interface OpenFileResult {
  path: string;
  text: string;
  /** Canonical file URI for the renderer's document/session identity. */
  readonly uri?: string;
  /** Selection token; activation commits the file as the current save/resource context. */
  readonly activationToken?: string;
  readonly kind?: 'file' | 'generated';
}

export interface SaveFileResult {
  path: string;
  /** Canonical file URI adopted after a successful save or save-as. */
  readonly uri?: string;
}

export interface FileOpenedEvent extends OpenFileResult {
  path: string;
  text: string;
}

export type HostCommand = 'new' | 'open' | 'save' | 'save-as' | 'show-commands';
export type WindowCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all' | 'reset-zoom' | 'zoom-in' | 'zoom-out' | 'toggle-fullscreen' | 'quit';

/** Renderer-safe bridge for file workflows and opening links outside the app. */
export interface ElectronBridge {
  readonly platform: NodeJS.Platform;
  openFile(): Promise<OpenFileResult | null>;
  saveFile(path: string, text: string): Promise<SaveFileResult>;
  saveFileAs(text: string): Promise<SaveFileResult | null>;
  /** Allocates a fresh untitled URI without writing a file. */
  newDocument?(): Promise<{ readonly uri: string; readonly title: string }>;
  /** Commits a previously selected file after the renderer accepts replacement. */
  activateDocument?(path: string, activationToken?: string): Promise<void>;
  /** Drops a selected replacement after Save/Discard/Cancel chooses Cancel. */
  discardDocument?(activationToken: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  readResource(uri: string): Promise<{ uri: string; content: string; contentHash: string }>;
  listConversionCommands(): Promise<ConversionCommandsManifest>;
  selectConversionSource(request: SelectConversionSourceRequest): Promise<ConversionSource | undefined>;
  convert(request: ConversionRequest): Promise<ConversionResult>;
  onConversionProgress(listener: (event: ProgressEvent) => void): () => void;
  cancelConversion(requestId: string): Promise<void>;
  openGeneratedOutput(request: OpenGeneratedOutputRequest): Promise<OpenGeneratedOutputResult>;
  libraryRequest<T>(operation: LibraryOperation, payload?: unknown): Promise<T>;
  listLibraryEntries(): Promise<readonly LibraryEntry[]>;
  readLibraryDocument(entryId: string, version: string): Promise<LibraryDocument>;
  onFileOpened(listener: (file: FileOpenedEvent) => void): () => void;
  onFileCommand(listener: (command: HostCommand) => void): () => void;
  executeWindowCommand(command: WindowCommand): Promise<void>;
  setTitleBarTheme(theme: 'dark' | 'light' | 'contrast'): Promise<void>;
}
