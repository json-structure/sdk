'use strict';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input.trim());
  if (request.sourceName === 'hang.struct.json') {
    setInterval(() => undefined, 1000);
    return;
  }
  if (request.sourceName === 'stdout.struct.json') {
    process.stdout.write('x'.repeat(4096));
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
  }) + '\n');
});