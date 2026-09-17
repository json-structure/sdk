'use strict';
const { dirname, join } = require('node:path');
const { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const marker = process.env.STRUCTURIZE_TEST_ARGS;
if (!marker) throw new Error('STRUCTURIZE_TEST_ARGS is required.');
appendFileSync(marker, JSON.stringify(args) + '\n');
const outputIndex = args.indexOf('--out');
if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--out is required.');
const output = args[outputIndex + 1];
const outputFile = existsSync(output) && statSync(output).isDirectory() ? join(output, 'generated.json') : output;
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, JSON.stringify({
  $schema: 'https://json-structure.org/meta/core/v0/#',
  $id: 'urn:test:structurize-args',
  name: 'Observed',
  type: 'object',
  properties: {},
}) + '\n');
