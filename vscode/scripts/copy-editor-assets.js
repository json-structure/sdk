const { cpSync, copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const media = join(root, 'vscode', 'media');
cpSync(join(root, 'editor', 'src', 'conversion', 'worker-runtime'), join(media, 'conversion', 'worker-runtime'), { recursive: true });
mkdirSync(join(media, 'libraries'), { recursive: true });
copyFileSync(join(root, 'vscode', 'test-fixtures', 'financial-types', 'schema.struct.json'), join(media, 'libraries', 'financial-types.struct.json'));