import type { ConversionRequest, ConversionResult, ConversionSource, LibraryOperation, OpenGeneratedOutputRequest, OpenGeneratedOutputResult, ProgressEvent, SelectConversionSourceRequest } from '../contracts';
import type { ConversionCommandsManifest } from '../conversion/types';
import type { LibraryDocument, LibraryEntry } from '../libraries/contracts';

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

export type HostCommand = 'open' | 'save' | 'save-as' | 'show-commands';

/** Renderer-safe bridge for file workflows and opening links outside the app. */
export interface ElectronBridge {
  openFile(): Promise<OpenFileResult | null>;
  saveFile(path: string, text: string): Promise<SaveFileResult>;
  saveFileAs(text: string): Promise<SaveFileResult | null>;
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
}