#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDirectory = path.resolve(__dirname, '..', 'dist-test', 'test', 'unit');

let testFiles;
try {
  testFiles = fs
    .readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => path.join(testDirectory, entry.name))
    .sort();
} catch (error) {
  console.error(`Unable to read compiled unit tests from ${testDirectory}.`);
  console.error(error);
  process.exitCode = 1;
  return;
}

if (testFiles.length === 0) {
  console.error(`No compiled unit tests found in ${testDirectory}.`);
  process.exitCode = 1;
  return;
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  console.error('Unable to start the Node.js test runner.');
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
