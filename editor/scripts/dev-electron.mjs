import { spawn } from 'node:child_process';

const url = 'http://127.0.0.1:5173';
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    await fetch(url);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const command = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const child = spawn(command, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url }, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));