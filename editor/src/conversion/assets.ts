import { resolve } from 'node:path';

const conversionDir = resolve(process.cwd(), 'src', 'conversion');

export const PACKAGED_RUNTIME_DESCRIPTOR_PATH = resolve(conversionDir, 'worker-runtime', 'runtime-descriptor.json');
export const PACKAGED_COMMANDS_MANIFEST_PATH = resolve(conversionDir, 'worker-runtime', 'commands-manifest.json');
