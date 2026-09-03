'use strict';

let input = '';
let handled = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  const newline = input.indexOf('\n');
  if (handled || newline < 0) return;
  handled = true;
  const request = JSON.parse(input.slice(0, newline).trim());
  if (request.sourceName === 'hang.struct.json') {
    setInterval(() => undefined, 1000);
    return;
  }
  if (request.sourceName === 'stdout.struct.json') {
    process.stdout.write('x'.repeat(4096), () => process.exit(0));
    return;
  }
  const evidence = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    operationId: request.operationId,
    execArgv: process.execArgv,
  };
  process.stdout.write(JSON.stringify({
    type: 'result',
    operationId: request.operationId,
    lossiness: 'none',
    warnings: [],
    files: [{ path: 'evidence.schema.json', contentBase64: Buffer.from(JSON.stringify(evidence)).toString('base64') }],
  }) + '\n', () => process.exit(0));
});