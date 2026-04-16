#!/usr/bin/env node
// CLI entry point for Claude Code Office.
// When installed globally via npm, this script launches the Electron app.
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);

let electronPath;
try {
  electronPath = require('electron');
} catch {
  console.error(
    'Error: electron is not installed.\n' +
    'Run "npm install" in the project root first, or install globally:\n' +
    '  npm install -g electron'
  );
  process.exit(1);
}

// If electron module returns a path string, use it directly.
// Some versions of the electron npm package export the binary path as a string.
if (typeof electronPath !== 'string') {
  console.error(
    'Error: could not resolve electron binary path.\n' +
    'The installed electron package did not export a usable path.'
  );
  process.exit(1);
}

const appPath = path.resolve(__dirname, '..');

const child = spawn(electronPath, [appPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env },
  // On Windows, use shell to handle .cmd/.bat electron wrappers
  shell: process.platform === 'win32',
});

child.on('error', (err) => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
