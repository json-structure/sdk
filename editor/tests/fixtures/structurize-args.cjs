'use strict';
const { dirname } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const marker = process.env.STRUCTURIZE_TEST_ARGS;
if (!marker) throw new Error('STRUCTURIZE_TEST_ARGS is required.');
writeFileSync(marker, JSON.stringify(args));
const outputIndex = args.indexOf('--out');
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--out is required.');
const output = args[outputIndex + 1];
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'urn:test:structurize-args',
  name: 'Observed',
  type: 'object',
  properties: {},
}) + '\n');
