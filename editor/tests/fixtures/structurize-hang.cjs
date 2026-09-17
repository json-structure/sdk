#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');

const marker = process.env.STRUCTURIZE_TEST_MARKER;
if (!marker) throw new Error('STRUCTURIZE_TEST_MARKER is required.');

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
  stdio: 'ignore',
  windowsHide: true,
});
writeFileSync(marker, JSON.stringify({
  pid: process.pid,
  grandchildPid: grandchild.pid,
  workspace: process.cwd(),
}));
setInterval(() => undefined, 1000);
