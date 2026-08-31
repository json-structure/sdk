import { describe, expect, it } from 'vitest';
import { resourceSnapshot } from '../src/external-documents.js';
import { loadExternalDocuments } from '../src/external-documents.js';
import { resolveEffectiveMembers } from '../src/phase4/effective-members.js';
import { DocumentSession } from '../src/session.js';

describe('resolved schema environment', () => {
  it('retains parsed external schema values for effective and instance evaluators', async () => {
    const externalUri = 'https://example.test/shared.struct.json';
    const external = JSON.stringify({
      $id: externalUri,
      definitions: { Entity: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    });
    const documents = await loadExternalDocuments('https://example.test/root.struct.json', [externalUri], async (uri) => resourceSnapshot('read', uri, external));
    const session = new DocumentSession('https://example.test/root.struct.json', JSON.stringify({
      definitions: {
        shared: { $importdefs: externalUri },
        Local: { type: 'object', $extends: '#/definitions/shared/Entity', properties: { name: { type: 'string' } } },
      },
    }));
    session.setExternalDocuments(documents);

    expect(session.resolvedSchemaDocuments).toEqual([{ uri: externalUri, document: JSON.parse(external) }]);
    expect(resolveEffectiveMembers(session.value as Record<string, unknown>, '#/definitions/Local', {
      documentUri: session.uri,
      resolvedDocuments: session.resolvedSchemaDocuments,
    }).members.map((member) => member.name)).toEqual(['id', 'name']);
  });
});