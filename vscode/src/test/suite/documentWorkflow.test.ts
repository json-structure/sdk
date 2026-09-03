import * as assert from 'assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as path from 'path';
import { assertRendererArtifactIntegrity } from '../artifact-integrity';
import * as vscode from 'vscode';
import { classifyGeneratedOutputs, customEditorViewType, VsCodeConversionHost } from '../../editorServices';
import { readWorkspaceResource } from '../../customEditor';
import type { JsonStructureExtensionApi } from '../../extension';
import { defaultUntitledDocument, jsonStructureEditorViewType } from '../../customEditor';

function customEditorTabs(): readonly vscode.Tab[] {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => {
        const input = tab.input;
        return input instanceof vscode.TabInputCustom && input.viewType === jsonStructureEditorViewType;
    });
}

function customInput(tab: vscode.Tab): vscode.TabInputCustom {
    if (!(tab.input instanceof vscode.TabInputCustom)) throw new Error('Expected a custom editor tab.');
    return tab.input;
}


async function waitForRendererReady(uri: vscode.Uri): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const extension = vscode.extensions.getExtension<JsonStructureExtensionApi>('jsonstructure.json-structure');
        if (extension?.isActive && extension.exports?.isRendererReady(uri.toString())) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for the mounted renderer for ${uri.toString()}.`);
}

async function waitForCustomTab(uri: vscode.Uri): Promise<vscode.Tab> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const tab = customEditorTabs().find(candidate => candidate.input instanceof vscode.TabInputCustom && candidate.input.uri.toString() === uri.toString());
        if (tab) return tab;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for custom editor tab for ${uri.toString()}.`);
}

suite('JSON Structure document workflow', () => {
    test('verifies the existing renderer artifact before a rebuild', async () => {
        await assertRendererArtifactIntegrity();
    });

    test('classifies generated JSON Structure, schema, Avro, SQL, proto, and directory outputs', () => {
        const output = (name: string) => ({ uri: path.join('C:\\generated', name), name });
        assert.strictEqual(classifyGeneratedOutputs([output('target.struct.json')]), 'json-structure');
        assert.strictEqual(classifyGeneratedOutputs([output('schema.json')]), 'file');
        assert.strictEqual(classifyGeneratedOutputs([output('record.avsc')]), 'file');
        assert.strictEqual(classifyGeneratedOutputs([output('tables.sql')]), 'file');
        assert.strictEqual(classifyGeneratedOutputs([output('messages.proto')]), 'file');
        assert.strictEqual(classifyGeneratedOutputs([output('a.ts'), output('b.ts')]), 'directory');
    });

    test('shares the custom editor identity across generated and new documents', () => {
        assert.strictEqual(jsonStructureEditorViewType, customEditorViewType);
        assert.strictEqual(JSON.parse(defaultUntitledDocument).$id, 'urn:json-structure:untitled');
    });

    test('invokes newDocument and vscode.openWith through the live extension host', async () => {
        const fixture = vscode.Uri.file(path.resolve(__dirname, '../../../test-fixtures/valid-schema.struct.json'));
        await vscode.commands.executeCommand('vscode.openWith', fixture, jsonStructureEditorViewType);
        const openedTab = await waitForCustomTab(fixture);
        assert.strictEqual(customInput(openedTab).viewType, jsonStructureEditorViewType);
        await waitForRendererReady(fixture);
        const extension = vscode.extensions.getExtension<JsonStructureExtensionApi>('jsonstructure.json-structure');
        assert.ok(extension?.exports?.isRendererReady(fixture.toString()), 'The extension host did not receive renderer readiness evidence.');

        const newDocument = await vscode.commands.executeCommand<vscode.TextDocument>('jsonStructure.newDocument');
        assert.strictEqual(newDocument.uri.scheme, 'untitled');
        const newTab = await waitForCustomTab(newDocument.uri);
        assert.strictEqual(customInput(newTab).uri.toString(), newDocument.uri.toString());

        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('exports a relative namespace import through the live extension host', async () => {
        const root = path.resolve(__dirname, '../../../test-fixtures', `.vscode-import-${Date.now()}`);
        const mainPath = path.join(root, 'main.struct.json');
        const libraryPath = path.join(root, 'library.struct.json');
        const outputPath = path.join(root, 'generated');
        const mainUri = vscode.Uri.file(mainPath);
        const libraryUri = pathToFileURL(libraryPath).toString();
        const main = {
            $schema: 'https://json-structure.org/meta/extended/v0/#',
            $id: pathToFileURL(mainPath).toString(),
            name: 'Main',
            $root: '#/definitions/Main',
            definitions: {
                vendor: { $importdefs: './library.struct.json' },
                Main: { type: 'object', properties: { name: { type: { $ref: '#/definitions/vendor/Value' } } } }
            }
        };
        const library = {
            $schema: 'https://json-structure.org/meta/core/v0/#',
            $id: libraryUri,
            name: 'Library',
            definitions: { Value: { type: 'string' } }
        };
        try {
            await mkdir(root, { recursive: true });
            await writeFile(mainPath, JSON.stringify(main, null, 2), 'utf8');
            await writeFile(libraryPath, JSON.stringify(library, null, 2), 'utf8');
            const document = await vscode.workspace.openTextDocument(mainUri);
            const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));
            const host = new VsCodeConversionHost(extensionUri, {
                selectDestination: async () => vscode.Uri.file(outputPath),
                readResource: async (documentUri, resourceUri) => ({
                    uri: resourceUri,
                    content: await readWorkspaceResource(vscode.Uri.parse(documentUri, true), vscode.Uri.parse(resourceUri, true))
                })
            });
            const result = await host.convert({
                protocolVersion: 1,
                requestId: 'vscode-relative-import-export',
                kind: 'conversion',
                documentVersion: document.version,
                commandId: 'export.json-structure.to-jsonschema',
                sourceName: path.basename(mainPath),
                sourceText: document.getText(),
                options: {}
            }, undefined, mainUri.toString());
            assert.strictEqual(result.succeeded, true, JSON.stringify(result.diagnostics));
            assert.ok(result.review && typeof result.review === 'object' && 'targetFormat' in result.review && result.review.targetFormat === 'json-schema');
            assert.ok(Array.isArray(result.diagnostics));
            assert.ok(result.diagnostics.every((diagnostic) => typeof diagnostic === 'object' && diagnostic !== null && 'severity' in diagnostic && diagnostic.severity !== 'error'));
            const generated = JSON.parse((await readFile(path.join(outputPath, 'schema.json'), 'utf8')));
            assert.strictEqual(generated.$defs.vendor.Value.type, 'string');
            assert.strictEqual(generated.properties.name.$ref, '#/$defs/vendor/Value');
        } finally {
            await rm(root, { recursive: true, force: true });
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});
