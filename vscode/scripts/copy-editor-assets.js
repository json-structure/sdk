const { createHash } = require('node:crypto');
const { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const media = join(root, 'vscode', 'media');
const sourceRuntime = join(root, 'editor', 'src', 'conversion', 'worker-runtime');
const destinationRuntime = join(media, 'conversion', 'worker-runtime');
const descriptorPath = join(sourceRuntime, 'runtime-descriptor.json');
const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
descriptor.files = descriptor.files.map((entry) => ({
	...entry,
	sha256: createHash('sha256').update(readFileSync(join(sourceRuntime, entry.path.replace(/^worker-runtime[\\/]/, '')))).digest('hex'),
}));
writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);
rmSync(destinationRuntime, { recursive: true, force: true });
cpSync(sourceRuntime, destinationRuntime, { recursive: true });
for (const entry of descriptor.files) {
	const relativePath = entry.path.replace(/^worker-runtime[\\/]/, '');
	const source = readFileSync(join(sourceRuntime, relativePath));
	const copied = readFileSync(join(destinationRuntime, relativePath));
	if (!source.equals(copied)) throw new Error(`Copied conversion asset differs from source: ${relativePath}`);
}
if (!readFileSync(descriptorPath).equals(readFileSync(join(destinationRuntime, 'runtime-descriptor.json')))) throw new Error('Copied runtime descriptor differs from source.');
mkdirSync(join(media, 'libraries'), { recursive: true });
copyFileSync(join(root, 'vscode', 'test-fixtures', 'financial-types', 'schema.struct.json'), join(media, 'libraries', 'financial-types.struct.json'));