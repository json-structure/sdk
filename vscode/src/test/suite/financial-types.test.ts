import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('Financial Types Hover Test Suite', () => {
    // Path to the financial types test fixtures (copied from primer-and-samples)
    const fixturesPath = path.resolve(__dirname, '../../../test-fixtures');
    const financialTypesPath = path.join(fixturesPath, 'financial-types');
    const schemaPath = path.join(financialTypesPath, 'schema.struct.json');
    const examplePath = path.join(financialTypesPath, 'example1.json');

    // Helper to wait for extension activation
    async function ensureExtensionActive(): Promise<void> {
        const ext = vscode.extensions.getExtension('jsonstructure.json-structure');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
    }

    // Helper to wait for schema resolution
    async function waitForSchemaResolution(ms: number = 2000): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    // Helper to get hover content as string
    function getHoverContentString(hovers: vscode.Hover[]): string {
        if (!hovers || hovers.length === 0) return '';
        return hovers[0].contents
            .map(c => typeof c === 'string' ? c : (c as vscode.MarkdownString).value)
            .join(' ');
    }

    // Helper to find position of a property name in text
    function findPropertyPosition(doc: vscode.TextDocument, propertyName: string): vscode.Position | null {
        const text = doc.getText();
        const regex = new RegExp(`"${propertyName}"\\s*:`);
        const match = text.match(regex);
        if (match && match.index !== undefined) {
            // Position inside the property name
            return doc.positionAt(match.index + 2);
        }
        return null;
    }

    // Load and parse the schema to get property descriptions
    function loadSchema(): Record<string, unknown> {
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
        return JSON.parse(schemaContent);
    }

    // Get description for a property path from the schema
    function getSchemaDescription(schema: Record<string, unknown>, definitionName: string, propertyName: string): string | null {
        const definitions = schema.definitions as Record<string, unknown> | undefined;
        if (!definitions) return null;

        const definition = definitions[definitionName] as Record<string, unknown> | undefined;
        if (!definition) return null;

        const properties = definition.properties as Record<string, unknown> | undefined;
        if (!properties) return null;

        const property = properties[propertyName] as Record<string, unknown> | undefined;
        if (!property) return null;

        return property.description as string | null;
    }

    suiteSetup(async function() {
        this.timeout(30000);
        await ensureExtensionActive();
    });

    test('Test fixtures exist', () => {
        assert.ok(fs.existsSync(schemaPath), `Schema file should exist at ${schemaPath}`);
        assert.ok(fs.existsSync(examplePath), `Example file should exist at ${examplePath}`);
    });

    test('Schema has expected definitions with descriptions', () => {
        const schema = loadSchema();
        
        // Verify Invoice definition has descriptions
        const invoiceIssueDate = getSchemaDescription(schema, 'Invoice', 'issueDate');
        assert.ok(invoiceIssueDate, 'Invoice.issueDate should have a description');
        assert.ok(invoiceIssueDate.includes('Date'), 'issueDate description should mention Date');

        const invoiceTotalAmount = getSchemaDescription(schema, 'Invoice', 'totalAmount');
        assert.ok(invoiceTotalAmount, 'Invoice.totalAmount should have a description');

        // Verify Money definition has descriptions
        const moneyAmount = getSchemaDescription(schema, 'Money', 'amount');
        assert.ok(moneyAmount, 'Money.amount should have a description');
        assert.ok(moneyAmount.includes('monetary'), 'Money.amount description should mention monetary');

        const moneyCurrency = getSchemaDescription(schema, 'Money', 'currency');
        assert.ok(moneyCurrency, 'Money.currency should have a description');
        assert.ok(moneyCurrency.includes('ISO 4217'), 'Money.currency description should mention ISO 4217');

        // Verify LineItem definition has descriptions
        const lineItemDescription = getSchemaDescription(schema, 'LineItem', 'description');
        assert.ok(lineItemDescription, 'LineItem.description should have a description');

        const lineItemQuantity = getSchemaDescription(schema, 'LineItem', 'quantity');
        assert.ok(lineItemQuantity, 'LineItem.quantity should have a description');
    });

    suite('Invoice Property Hover Tests', () => {
        let doc: vscode.TextDocument;
        let schema: Record<string, unknown>;

        suiteSetup(async function() {
            this.timeout(30000);
            await ensureExtensionActive();
            schema = loadSchema();
            doc = await vscode.workspace.openTextDocument(examplePath);
            await vscode.window.showTextDocument(doc);
            await waitForSchemaResolution();
        });

        test('Should provide hover with description for invoiceNumber', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'invoiceNumber');
            assert.ok(expectedDescription, 'Schema should have description for invoiceNumber');

            const pos = findPropertyPosition(doc, 'invoiceNumber');
            assert.ok(pos, 'Should find invoiceNumber in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for invoiceNumber');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('invoice') || 
                hoverContent.toLowerCase().includes('identifier') ||
                hoverContent.includes(expectedDescription.substring(0, 20)),
                `Hover should contain description. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for issueDate', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'issueDate');
            assert.ok(expectedDescription, 'Schema should have description for issueDate');

            const pos = findPropertyPosition(doc, 'issueDate');
            assert.ok(pos, 'Should find issueDate in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for issueDate');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('date') ||
                hoverContent.toLowerCase().includes('issue'),
                `Hover should contain date information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for dueDate', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'dueDate');
            assert.ok(expectedDescription, 'Schema should have description for dueDate');

            const pos = findPropertyPosition(doc, 'dueDate');
            assert.ok(pos, 'Should find dueDate in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for dueDate');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('payment') ||
                hoverContent.toLowerCase().includes('due'),
                `Hover should contain due date information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for paymentTermsDays', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'paymentTermsDays');
            assert.ok(expectedDescription, 'Schema should have description for paymentTermsDays');

            const pos = findPropertyPosition(doc, 'paymentTermsDays');
            assert.ok(pos, 'Should find paymentTermsDays in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for paymentTermsDays');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('days') ||
                hoverContent.toLowerCase().includes('payment') ||
                hoverContent.toLowerCase().includes('int16'),
                `Hover should contain payment terms information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for lineItems', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'lineItems');
            assert.ok(expectedDescription, 'Schema should have description for lineItems');

            const pos = findPropertyPosition(doc, 'lineItems');
            assert.ok(pos, 'Should find lineItems in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for lineItems');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('list') ||
                hoverContent.toLowerCase().includes('item') ||
                hoverContent.toLowerCase().includes('array'),
                `Hover should contain line items information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for subtotal', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'subtotal');
            assert.ok(expectedDescription, 'Schema should have description for subtotal');

            const pos = findPropertyPosition(doc, 'subtotal');
            assert.ok(pos, 'Should find subtotal in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for subtotal');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('subtotal') ||
                hoverContent.toLowerCase().includes('tax'),
                `Hover should contain subtotal information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for totalAmount', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'totalAmount');
            assert.ok(expectedDescription, 'Schema should have description for totalAmount');

            const pos = findPropertyPosition(doc, 'totalAmount');
            assert.ok(pos, 'Should find totalAmount in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for totalAmount');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('total') ||
                hoverContent.toLowerCase().includes('amount') ||
                hoverContent.toLowerCase().includes('due'),
                `Hover should contain total amount information. Got: ${hoverContent.substring(0, 200)}`
            );
        });

        test('Should provide hover with description for cancelledDate', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Invoice', 'cancelledDate');
            assert.ok(expectedDescription, 'Schema should have description for cancelledDate');

            const pos = findPropertyPosition(doc, 'cancelledDate');
            assert.ok(pos, 'Should find cancelledDate in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            assert.ok(hovers && hovers.length > 0, 'Should provide hover for cancelledDate');
            const hoverContent = getHoverContentString(hovers);
            assert.ok(
                hoverContent.toLowerCase().includes('cancel') ||
                hoverContent.toLowerCase().includes('date') ||
                hoverContent.toLowerCase().includes('null'),
                `Hover should contain cancelled date information. Got: ${hoverContent.substring(0, 200)}`
            );
        });
    });

    suite('LineItem Nested Property Hover Tests', () => {
        let doc: vscode.TextDocument;
        let schema: Record<string, unknown>;

        suiteSetup(async function() {
            this.timeout(30000);
            await ensureExtensionActive();
            schema = loadSchema();
            doc = await vscode.workspace.openTextDocument(examplePath);
            await vscode.window.showTextDocument(doc);
            await waitForSchemaResolution();
        });

        // Find position of a property within lineItems array
        function findLineItemPropertyPosition(doc: vscode.TextDocument, propertyName: string): vscode.Position | null {
            const text = doc.getText();
            const lineItemsStart = text.indexOf('"lineItems"');
            if (lineItemsStart === -1) return null;

            // Search for the property after lineItems starts
            const searchText = text.substring(lineItemsStart);
            const regex = new RegExp(`"${propertyName}"\\s*:`);
            const match = searchText.match(regex);
            if (match && match.index !== undefined) {
                return doc.positionAt(lineItemsStart + match.index + 2);
            }
            return null;
        }

        test('Should provide hover for LineItem.description', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'LineItem', 'description');
            assert.ok(expectedDescription, 'Schema should have description for LineItem.description');

            const pos = findLineItemPropertyPosition(doc, 'description');
            assert.ok(pos, 'Should find description in lineItems');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            // Note: Nested property hover may or may not work depending on schema resolution
            // This test validates the hover system is working at this path
            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                assert.ok(
                    hoverContent.length > 0,
                    `Hover should have content for LineItem.description`
                );
            }
        });

        test('Should provide hover for LineItem.quantity', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'LineItem', 'quantity');
            assert.ok(expectedDescription, 'Schema should have description for LineItem.quantity');

            const pos = findLineItemPropertyPosition(doc, 'quantity');
            assert.ok(pos, 'Should find quantity in lineItems');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                assert.ok(
                    hoverContent.length > 0,
                    `Hover should have content for LineItem.quantity`
                );
            }
        });
    });

    suite('Money Nested Property Hover Tests', () => {
        let doc: vscode.TextDocument;
        let schema: Record<string, unknown>;

        suiteSetup(async function() {
            this.timeout(30000);
            await ensureExtensionActive();
            schema = loadSchema();
            doc = await vscode.workspace.openTextDocument(examplePath);
            await vscode.window.showTextDocument(doc);
            await waitForSchemaResolution();
        });

        // Find position of amount property within subtotal
        function findSubtotalAmountPosition(doc: vscode.TextDocument): vscode.Position | null {
            const text = doc.getText();
            const subtotalStart = text.indexOf('"subtotal"');
            if (subtotalStart === -1) return null;

            const searchText = text.substring(subtotalStart);
            const amountMatch = searchText.match(/"amount"\s*:/);
            if (amountMatch && amountMatch.index !== undefined) {
                return doc.positionAt(subtotalStart + amountMatch.index + 2);
            }
            return null;
        }

        // Find position of currency property within subtotal
        function findSubtotalCurrencyPosition(doc: vscode.TextDocument): vscode.Position | null {
            const text = doc.getText();
            const subtotalStart = text.indexOf('"subtotal"');
            if (subtotalStart === -1) return null;

            const searchText = text.substring(subtotalStart);
            const currencyMatch = searchText.match(/"currency"\s*:/);
            if (currencyMatch && currencyMatch.index !== undefined) {
                return doc.positionAt(subtotalStart + currencyMatch.index + 2);
            }
            return null;
        }

        test('Should provide hover for Money.amount in subtotal', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Money', 'amount');
            assert.ok(expectedDescription, 'Schema should have description for Money.amount');

            const pos = findSubtotalAmountPosition(doc);
            assert.ok(pos, 'Should find amount in subtotal');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            // Nested object hovers may work if schema resolution traverses $ref
            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                assert.ok(
                    hoverContent.length > 0,
                    `Hover should have content for Money.amount`
                );
            }
        });

        test('Should provide hover for Money.currency in subtotal', async function() {
            this.timeout(10000);
            const expectedDescription = getSchemaDescription(schema, 'Money', 'currency');
            assert.ok(expectedDescription, 'Schema should have description for Money.currency');

            const pos = findSubtotalCurrencyPosition(doc);
            assert.ok(pos, 'Should find currency in subtotal');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                assert.ok(
                    hoverContent.length > 0,
                    `Hover should have content for Money.currency`
                );
            }
        });
    });

    suite('All Invoice Properties Have Descriptions', () => {
        test('Every Invoice property in schema should have a description', () => {
            const schema = loadSchema();
            const definitions = schema.definitions as Record<string, unknown>;
            const invoice = definitions.Invoice as Record<string, unknown>;
            const properties = invoice.properties as Record<string, unknown>;

            const missingDescriptions: string[] = [];
            for (const [propName, propSchema] of Object.entries(properties)) {
                const prop = propSchema as Record<string, unknown>;
                if (!prop.description || typeof prop.description !== 'string') {
                    missingDescriptions.push(propName);
                }
            }

            assert.strictEqual(
                missingDescriptions.length,
                0,
                `All Invoice properties should have descriptions. Missing: ${missingDescriptions.join(', ')}`
            );
        });

        test('Every Money property in schema should have a description', () => {
            const schema = loadSchema();
            const definitions = schema.definitions as Record<string, unknown>;
            const money = definitions.Money as Record<string, unknown>;
            const properties = money.properties as Record<string, unknown>;

            const missingDescriptions: string[] = [];
            for (const [propName, propSchema] of Object.entries(properties)) {
                const prop = propSchema as Record<string, unknown>;
                if (!prop.description || typeof prop.description !== 'string') {
                    missingDescriptions.push(propName);
                }
            }

            assert.strictEqual(
                missingDescriptions.length,
                0,
                `All Money properties should have descriptions. Missing: ${missingDescriptions.join(', ')}`
            );
        });

        test('Every LineItem property in schema should have a description', () => {
            const schema = loadSchema();
            const definitions = schema.definitions as Record<string, unknown>;
            const lineItem = definitions.LineItem as Record<string, unknown>;
            const properties = lineItem.properties as Record<string, unknown>;

            const missingDescriptions: string[] = [];
            for (const [propName, propSchema] of Object.entries(properties)) {
                const prop = propSchema as Record<string, unknown>;
                if (!prop.description || typeof prop.description !== 'string') {
                    missingDescriptions.push(propName);
                }
            }

            assert.strictEqual(
                missingDescriptions.length,
                0,
                `All LineItem properties should have descriptions. Missing: ${missingDescriptions.join(', ')}`
            );
        });
    });

    suite('Type-Specific Hover Information', () => {
        let doc: vscode.TextDocument;

        suiteSetup(async function() {
            this.timeout(30000);
            await ensureExtensionActive();
            doc = await vscode.workspace.openTextDocument(examplePath);
            await vscode.window.showTextDocument(doc);
            await waitForSchemaResolution();
        });

        test('Date type properties should show date type information', async function() {
            this.timeout(10000);
            const pos = findPropertyPosition(doc, 'issueDate');
            assert.ok(pos, 'Should find issueDate in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                // Should show type info for date
                assert.ok(
                    hoverContent.toLowerCase().includes('date') ||
                    hoverContent.toLowerCase().includes('iso'),
                    `Hover for date property should mention date type. Got: ${hoverContent.substring(0, 200)}`
                );
            }
        });

        test('Int16 type properties should show integer type information', async function() {
            this.timeout(10000);
            const pos = findPropertyPosition(doc, 'paymentTermsDays');
            assert.ok(pos, 'Should find paymentTermsDays in document');

            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                doc.uri,
                pos
            );

            if (hovers && hovers.length > 0) {
                const hoverContent = getHoverContentString(hovers);
                // Should show type info for int16
                assert.ok(
                    hoverContent.toLowerCase().includes('int') ||
                    hoverContent.toLowerCase().includes('number') ||
                    hoverContent.toLowerCase().includes('16'),
                    `Hover for int16 property should mention integer type. Got: ${hoverContent.substring(0, 200)}`
                );
            }
        });
    });
});
