export interface ConversionStorage {
  createStagingDirectory(destination: string, operationId: string): Promise<string>;
  writeFile(directory: string, relativePath: string, content: Uint8Array): Promise<void>;
  publishDirectory(stagingDirectory: string, destination: string, signal: AbortSignal): Promise<void>;
  removeDirectory(directory: string): Promise<void>;
}

export function validateRelativeOutputPath(path: string): void {
  if (!path || /^(?:[a-z]:|[\\/])/i.test(path) || path.split(/[\\/]/).includes('..')) throw new Error(`Unsafe output path: ${path}.`);
}

export function validateOutputPaths(paths: readonly string[]): void {
  const canonical = new Set<string>();
  for (const path of paths) {
    validateRelativeOutputPath(path);
    const key = path.replace(/\\/g, '/').toLocaleLowerCase('en-US');
    if (canonical.has(key)) throw new Error(`Duplicate or case-colliding output path: ${path}.`);
    canonical.add(key);
  }
}

/** Host-neutral all-or-nothing publication over a host-provided storage boundary. */
export async function publishAtomically(
  storage: ConversionStorage,
  destination: string,
  operationId: string,
  files: Readonly<Record<string, Uint8Array>>,
  manifest: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  const outputPaths = [...Object.keys(files), 'conversion-output-manifest.json'];
  validateOutputPaths(outputPaths);
  const staging = await storage.createStagingDirectory(destination, operationId);
  let published = false;
  try {
    for (const [path, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
      if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
      validateRelativeOutputPath(path);
      await storage.writeFile(staging, path, content);
    }
    await storage.writeFile(staging, 'conversion-output-manifest.json', manifest);
    if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    await storage.publishDirectory(staging, destination, signal);
    published = true;
  } finally {
    if (!published) await storage.removeDirectory(staging);
  }
}