const assert = require('node:assert/strict');
const { test } = require('node:test');

for (const format of ['CommonJS', 'ESM']) {
  test(`built ${format} package validates and serializes on the supported runtime`, async () => {
    const sdk = format === 'CommonJS'
      ? require('../dist/index.js')
      : await import('../dist/index.mjs');
    const schema = {
      $id: 'urn:example:runtime-compatibility',
      name: 'RuntimeCompatibility',
      type: 'object',
      properties: { amount: { type: 'int64' } },
      required: ['amount'],
    };
    assert.equal(new sdk.SchemaValidator().validate(schema).isValid, true);
    const validator = new sdk.InstanceValidator();
    assert.equal(validator.validate({ amount: '9223372036854775807' }, schema).isValid, true);
    assert.equal(validator.validate({ amount: '9223372036854775808' }, schema).isValid, false);
    assert.equal(JSON.stringify(new sdk.Int64('9223372036854775807')), '"9223372036854775807"');
  });
}
