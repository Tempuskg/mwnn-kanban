#!/usr/bin/env node
'use strict';

/**
 * Fail when node_modules/@tempuskg/mwnn-kanban-pro does not match the published
 * tarball that package-lock.json resolves. Catches a local Pro build copied into
 * node_modules with the same version label as the lockfile (the 1.0.10 failure).
 *
 * Uses only the registry fetch that `npm pack` already performs (auth via .npmrc).
 * Run via `npm run check:pro-package` before tagging a release.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');

const PACKAGE_NAME = '@tempuskg/mwnn-kanban-pro';
const LOCK_KEY = `node_modules/${PACKAGE_NAME}`;
const COMPARE_RELATIVE = 'dist/index.js';

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`check:pro-package: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function integrityOf(buffer) {
  return `sha512-${crypto.createHash('sha512').update(buffer).digest('base64')}`;
}

function sha256Of(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Read one file from a gzipped npm pack tarball (ustar / pax).
 * Paths inside the archive are `package/<relative>`.
 */
function readFileFromNpmTarball(tarballPath, relativePath) {
  const wanted = `package/${relativePath.replace(/\\/g, '/')}`;
  const gunzipped = zlib.gunzipSync(fs.readFileSync(tarballPath));
  let offset = 0;

  while (offset + 512 <= gunzipped.length) {
    const header = gunzipped.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeFlag = String.fromCharCode(header[156] || 0);

    if ((typeFlag === '0' || typeFlag === '\0') && fullName === wanted) {
      return Buffer.from(gunzipped.subarray(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512;
  }

  throw new Error(`Tarball is missing ${wanted}`);
}

function packPublishedTarball(version, destinationDir) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(
        process.execPath,
        [npmCli, 'pack', `${PACKAGE_NAME}@${version}`, '--pack-destination', destinationDir, '--json'],
        { cwd: root, encoding: 'utf8' },
      )
    : spawnSync(
        'npm',
        ['pack', `${PACKAGE_NAME}@${version}`, '--pack-destination', destinationDir, '--json'],
        { cwd: root, encoding: 'utf8', shell: true },
      );

  if (result.status !== 0) {
    fail(
      `npm pack ${PACKAGE_NAME}@${version} failed:\n${result.stderr || result.stdout || '(no output)'}`,
    );
  }

  let packed;
  try {
    packed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`Could not parse npm pack JSON output: ${error instanceof Error ? error.message : error}`);
  }

  const entry = Array.isArray(packed) ? packed[0] : packed;
  const filename = entry && (entry.filename || entry.name);
  if (!filename || typeof filename !== 'string') {
    fail(`npm pack did not report a tarball filename. Output:\n${result.stdout}`);
  }

  const tarballPath = path.isAbsolute(filename)
    ? filename
    : path.join(destinationDir, path.basename(filename));
  if (!fs.existsSync(tarballPath)) {
    fail(`npm pack reported ${filename} but the file was not found at ${tarballPath}`);
  }
  return tarballPath;
}

function main() {
  const lockPath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    fail('package-lock.json is missing');
  }

  const lock = readJson(lockPath);
  const lockEntry = lock.packages && lock.packages[LOCK_KEY];
  if (!lockEntry || typeof lockEntry.version !== 'string') {
    fail(`package-lock.json has no packages["${LOCK_KEY}"] entry`);
  }
  if (typeof lockEntry.integrity !== 'string' || !lockEntry.integrity.startsWith('sha512-')) {
    fail(`package-lock.json entry for ${PACKAGE_NAME} is missing a sha512 integrity`);
  }

  const installedDir = path.join(root, 'node_modules', ...PACKAGE_NAME.split('/'));
  const installedPkgPath = path.join(installedDir, 'package.json');
  if (!fs.existsSync(installedPkgPath)) {
    fail(`${PACKAGE_NAME} is not installed under node_modules (run npm ci)`);
  }

  const installedPkg = readJson(installedPkgPath);
  if (installedPkg.version !== lockEntry.version) {
    fail(
      `Installed ${PACKAGE_NAME}@${installedPkg.version} does not match lockfile version ${lockEntry.version}`,
    );
  }

  const installedFilePath = path.join(installedDir, ...COMPARE_RELATIVE.split('/'));
  if (!fs.existsSync(installedFilePath)) {
    fail(`Installed package is missing ${COMPARE_RELATIVE}`);
  }
  const installedBytes = fs.readFileSync(installedFilePath);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwnn-check-pro-'));
  try {
    const tarballPath = packPublishedTarball(lockEntry.version, tmpDir);
    const tarballBytes = fs.readFileSync(tarballPath);
    const actualIntegrity = integrityOf(tarballBytes);
    if (actualIntegrity !== lockEntry.integrity) {
      fail(
        `Published tarball integrity for ${PACKAGE_NAME}@${lockEntry.version} does not match package-lock.json.\n` +
          `  lockfile: ${lockEntry.integrity}\n` +
          `  packed:   ${actualIntegrity}`,
      );
    }

    const publishedBytes = readFileFromNpmTarball(tarballPath, COMPARE_RELATIVE);
    if (!installedBytes.equals(publishedBytes)) {
      fail(
        `Installed ${COMPARE_RELATIVE} does not match the published tarball for ${PACKAGE_NAME}@${lockEntry.version}.\n` +
          `  installed sha256: ${sha256Of(installedBytes)}\n` +
          `  published sha256: ${sha256Of(publishedBytes)}\n` +
          `Restore with: npm ci`,
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(
    `check:pro-package: ${PACKAGE_NAME}@${lockEntry.version} matches lockfile integrity and ${COMPARE_RELATIVE}`,
  );
}

main();
