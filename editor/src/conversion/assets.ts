import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const conversionDir = dirname(fileURLToPath(import.meta.url));

export const PACKAGED_RUNTIME_DESCRIPTOR_PATH = resolve(conversionDir, 'worker-runtime', 'runtime-descriptor.json');
export const PACKAGED_COMMANDS_MANIFEST_PATH = resolve(conversionDir, 'worker-runtime', 'commands-manifest.json');
