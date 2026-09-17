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
    test('opens an imported conversion as an unsaved untitled custom document without destination selection', async () => {
        const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));
        let destinationCalls = 0;
        const host = new VsCodeConversionHost(extensionUri, {
            selectDestination: async () => { destinationCalls += 1; throw new Error('Import must not select a destination.'); },
            readResource: async () => { throw new Error('Import must not resolve the current editor input schema.'); }
        });
        const result = await host.convert({ protocolVersion: 1, requestId: 'untitled-import', kind: 'conversion', documentVersion: 1, commandId: 'import.jsonschema.to-json-structure', sourceName: 'input.json', sourceText: '{"type":"string"}', options: {} });
        assert.strictEqual(result.succeeded, true); assert.strictEqual(destinationCalls, 0);
        assert.match(result.outputs[0].uri, /^generated-import:/);
        const review = result.review as { published: boolean; outputMode: string; lifecycle: string[] };
        assert.strictEqual(review.published, false); assert.strictEqual(review.outputMode, 'untitled-document'); assert.ok(!review.lifecycle.includes('publishing'));
        await assert.rejects(host.openOutputs([{ uri: 'C:\\Temp\\unapproved.struct.json', name: 'unapproved.struct.json' }]), /not committed/);
        await assert.rejects(host.openOutputs([{ ...result.outputs[0], name: 'forged.struct.json' }]), /not generated/);
        const imported = await host.openOutputs(result.outputs);
        assert.ok(imported); assert.strictEqual(imported.isUntitled, true); assert.strictEqual(imported.isDirty, true);
        assert.strictEqual(imported.uri.scheme, 'untitled'); assert.notStrictEqual(imported.uri.toString(), result.outputs[0].uri);
        assert.strictEqual(JSON.parse(imported.getText()).definitions.Root.type, 'string');
        const tab = await waitForCustomTab(imported.uri); assert.strictEqual(customInput(tab).viewType, customEditorViewType);
        await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    });

    test('refuses to open a generated import after its source document version changed', async () => {
        const source = await vscode.workspace.openTextDocument({ content: '{"before":true}', language: 'json' });
        const host = new VsCodeConversionHost(vscode.Uri.file(path.resolve(__dirname, '../../..')), { selectDestination: async () => { throw new Error('Import destination'); } });
        const result = await host.convert({ protocolVersion: 1, requestId: 'stale-untitled-import', kind: 'conversion', documentVersion: source.version, commandId: 'import.jsonschema.to-json-structure', sourceName: 'input.json', sourceText: '{"type":"string"}', options: {} }, undefined, source.uri.toString());
        assert.strictEqual(result.succeeded, true);
        const edit = new vscode.WorkspaceEdit(); edit.insert(source.uri, new vscode.Position(0, 0), ' '); assert.ok(await vscode.workspace.applyEdit(edit));
        await assert.rejects(host.openOutputs(result.outputs), /stale/);
        assert.strictEqual(source.getText(), ' {"before":true}'); assert.strictEqual(source.isDirty, true);
        await vscode.window.showTextDocument(source); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    });

    test('drops an import that becomes stale while its worker is running', async () => {
        const source = await vscode.workspace.openTextDocument({ content: '{"before":true}', language: 'json' });
        const host = new VsCodeConversionHost(vscode.Uri.file(path.resolve(__dirname, '../../..')), { selectDestination: async () => { throw new Error('Import destination'); } });
        const conversion = host.convert({ protocolVersion: 1, requestId: 'worker-stale-import', kind: 'conversion', documentVersion: source.version, commandId: 'import.jsonschema.to-json-structure', sourceName: 'input.json', sourceText: '{"type":"string"}', options: {} }, undefined, source.uri.toString());
        const edit = new vscode.WorkspaceEdit(); edit.insert(source.uri, new vscode.Position(0, 0), ' '); assert.ok(await vscode.workspace.applyEdit(edit));
        const result = await conversion;
        assert.strictEqual(result.succeeded, false); assert.deepStrictEqual(result.outputs, []);
        assert.match((result.diagnostics[0] as { message: string }).message, /changed while converting/);
        await vscode.window.showTextDocument(source); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    });

    test('releases pending imports only for the disposed source document', async () => {
        const firstSource = await vscode.workspace.openTextDocument({ content: '{"first":true}', language: 'json' });
        const secondSource = await vscode.workspace.openTextDocument({ content: '{"second":true}', language: 'json' });
        const host = new VsCodeConversionHost(vscode.Uri.file(path.resolve(__dirname, '../../..')), { selectDestination: async () => { throw new Error('Import destination'); } });
        const first = await host.convert({ protocolVersion: 1, requestId: 'first-pending-import', kind: 'conversion', documentVersion: firstSource.version, commandId: 'import.jsonschema.to-json-structure', sourceName: 'first.json', sourceText: '{"type":"string"}', options: {} }, undefined, firstSource.uri.toString());
        const second = await host.convert({ protocolVersion: 1, requestId: 'second-pending-import', kind: 'conversion', documentVersion: secondSource.version, commandId: 'import.jsonschema.to-json-structure', sourceName: 'second.json', sourceText: '{"type":"number"}', options: {} }, undefined, secondSource.uri.toString());
        host.releaseForDocument(firstSource.uri.toString());
        await assert.rejects(host.openOutputs(first.outputs), /not committed/);
        const opened = await host.openOutputs(second.outputs);
        assert.ok(opened); assert.strictEqual(opened.isUntitled, true);
        await vscode.window.showTextDocument(firstSource); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await vscode.window.showTextDocument(secondSource); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        await vscode.window.showTextDocument(opened); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    });

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
            const unsaved = { ...main, definitions: { ...main.definitions, Main: { ...main.definitions.Main, properties: { ...main.definitions.Main.properties, unsaved: { type: 'int32' } } } } };
            const edit = new vscode.WorkspaceEdit(); edit.replace(mainUri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), JSON.stringify(unsaved, null, 2));
            assert.ok(await vscode.workspace.applyEdit(edit)); assert.strictEqual(document.isDirty, true);
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
            assert.strictEqual(generated.properties.unsaved.type, 'integer');
            assert.ok(!JSON.parse(await readFile(mainPath, 'utf8')).definitions.Main.properties.unsaved);
            await vscode.window.showTextDocument(document); await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        } finally {
            await rm(root, { recursive: true, force: true });
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
    });
});
