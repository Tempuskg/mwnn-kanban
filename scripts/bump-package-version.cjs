#!/usr/bin/env node
'use strict';

/**
 * Patch-bump the version in package.json (and package-lock.json if present)
 * without creating a git tag or commit. Run via `npm run version:build`.
 */

const fs = require('node:fs');
const path = require('node:path');

function bumpPatch(version) {
  const parts = String(version).split('.');
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(Number(p)))) {
    throw new Error(`Unexpected version format: ${version}`);
  }
  parts[2] = String(Number(parts[2]) + 1);
  return parts.join('.');
}

function updateJson(file, nextVersion) {
  if (!fs.existsSync(file)) {
    return;
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = nextVersion;
  if (json.packages && json.packages['']) {
    json.packages[''].version = nextVersion;
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function updateReadme(file, currentVersion, nextVersion) {
  if (!fs.existsSync(file)) {
    return;
  }

  const currentBadge = `VS%20Marketplace-v${currentVersion}-007ACC`;
  const nextBadge = `VS%20Marketplace-v${nextVersion}-007ACC`;
  const currentLabel = `VS Marketplace v${currentVersion}`;
  const nextLabel = `VS Marketplace v${nextVersion}`;
  const readme = fs.readFileSync(file, 'utf8');

  if (!readme.includes(currentBadge) || !readme.includes(currentLabel)) {
    throw new Error(`README.md is missing the VS Marketplace v${currentVersion} badge`);
  }

  fs.writeFileSync(
    file,
    readme.replace(currentBadge, nextBadge).replace(currentLabel, nextLabel),
  );
}

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const next = bumpPatch(pkg.version);

updateJson(pkgPath, next);
updateJson(path.join(root, 'package-lock.json'), next);
updateReadme(path.join(root, 'README.md'), pkg.version, next);

console.log(`Bumped version: ${pkg.version} -> ${next}`);
