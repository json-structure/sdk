import { bootstrapJsonStructureEditor } from './bootstrap';

bootstrapJsonStructureEditor(document.querySelector('#editor'), JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'https://example.com/untitled.struct.json',
  name: 'UntitledStructure',
  definitions: {
    Address: { type: 'object', properties: { street: { type: 'string' }, postalCode: { type: 'string' } } },
    Person: { type: 'object', $extends: '#/definitions/Address', properties: { id: { type: 'uuid' }, name: { type: 'string' }, address: { type: { $ref: '#/definitions/Address' } } }, required: ['id', 'name'] }
  }
}, null, 2));