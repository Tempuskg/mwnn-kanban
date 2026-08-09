# Publishing MWNN Kanban

This runbook explains how to publish MWNN Kanban to both the Visual Studio
Marketplace and Open VSX. It covers the one-time account setup, release
preparation, the automated GitHub Actions path, a local fallback, verification,
and recovery from common failures.

Last verified: 2026-08-08

## Release identity

These values must remain aligned across the manifest, accounts, tokens, tag,
and both registries:

| Item                    | Value                           |
| ----------------------- | ------------------------------- |
| Extension ID            | `darrenjmcleod.mwnn-kanban`     |
| Publisher / namespace   | `darrenjmcleod`                 |
| Extension name          | `mwnn-kanban`                   |
| Display name            | `MWNN Kanban`                   |
| Current release version | `0.0.1`                         |
| VSIX filename           | `mwnn-kanban.vsix`              |
| Minimum VS Code version | `1.93.0`                        |
| Release workflow        | `.github/workflows/release.yml` |

The workflow builds one `mwnn-kanban.vsix` file and gives that exact artifact
to two independent publishing jobs. Do not build a different package for each
registry.

## Recommended release path

Use the GitHub workflow for normal releases:

1. Complete the one-time registry and secret setup.
2. Prepare and validate the release locally.
3. Commit and merge the release changes.
4. Push a tag that exactly matches the manifest version, such as `v0.0.1`.
5. Watch the `Release extension` workflow publish the same VSIX to both
   registries.
6. Verify both listings and install the published extension.

Use the local publishing path only when GitHub Actions is unavailable or when
recovering one failed registry publish.

## One-time prerequisites

### Local tools

Install the following:

- Git.
- Node.js 20 or newer, including npm.
- VS Code 1.93 or newer.
- Repository write access and permission to push release tags.
- Administrator access to the repository's GitHub Actions secrets.

Confirm the local tools from PowerShell:

```powershell
git --version
node --version
npm --version
code --version
```

The repository invokes current publishing CLIs through `npx`, so global
installations of `@vscode/vsce` and `ovsx` are not required.

### Visual Studio Marketplace account and publisher

1. Sign in to the [Visual Studio Marketplace publisher
   portal](https://marketplace.visualstudio.com/manage/publishers/) with the
   Microsoft account that will own the extension.
2. Create an Azure DevOps organization if the account does not already have
   one.
3. Create or confirm the publisher whose immutable ID is exactly
   `darrenjmcleod`. Check this carefully before creating it; the publisher ID
   becomes part of the public extension ID.
4. Confirm that the publishing identity is a member of that publisher with
   permission to publish extensions.
5. For the current PAT-based workflow, create an Azure DevOps Personal Access
   Token with:
   - Organization: **All accessible organizations**.
   - Scope: **Marketplace (Manage)**.
   - An expiration date that you will monitor.

6. Copy the token once and store it in a password manager until it has been
   added to GitHub as `VSCE_PAT`. Never commit it or put it in a repository
   file.

> **Deadline:** Microsoft has announced that global Azure DevOps PATs stop
> working on December 1, 2026. If publishing on or after that date, skip the
> PAT setup and complete the Microsoft Entra ID migration described later in
> this runbook.

### Open VSX account, agreement, token, and namespace

1. Create an [Eclipse account](https://accounts.eclipse.org/user/register).
   Fill in its GitHub username with the same GitHub account used to sign in to
   Open VSX.
2. Sign in to [Open VSX](https://open-vsx.org/) with GitHub.
3. Open the Open VSX profile settings, connect the Eclipse account, open the
   Publisher Agreement, read it, and accept it.
4. In Open VSX profile settings, generate an access token specifically for the
   GitHub Actions environment. Copy it once and store it securely until it has
   been added to GitHub as `OVSX_PAT`.
5. Create the `darrenjmcleod` namespace once. Enter the token without placing
   it directly in PowerShell history:

   ```powershell
   $secureToken = Read-Host 'Open VSX token' -AsSecureString
   $env:OVSX_PAT = [System.Net.NetworkCredential]::new('', $secureToken).Password
   npx --yes ovsx create-namespace darrenjmcleod -p $env:OVSX_PAT
   npx --yes ovsx verify-pat darrenjmcleod -p $env:OVSX_PAT
   Remove-Item Env:OVSX_PAT
   Remove-Variable secureToken
   ```

   `create-namespace` is a one-time action. If the namespace already exists,
   do not try to recreate or take over a namespace owned by someone else.

6. Namespace verification is optional but recommended after publishing. It is
   separate from the required Publisher Agreement and token setup.

### GitHub Actions secrets

1. Open the GitHub repository.
2. Go to **Settings → Secrets and variables → Actions**.
3. Select **New repository secret**.
4. Create `VSCE_PAT` with the Visual Studio Marketplace token.
5. Create `OVSX_PAT` with the Open VSX token.
6. Confirm the names exactly. GitHub secret names are case-sensitive in the
   workflow.

Do not put either token in repository variables, workflow YAML, `.env` files,
issues, logs, or release notes. Rotate a token immediately if it is exposed.

## Prepare a release

### 1. Start from the intended release commit

Confirm the active branch and workspace state:

```powershell
git branch --show-current
git status --short
```

Review every existing change before release. Do not discard unrelated user
work, and do not include local secrets or generated `*.vsix` files in the
commit. The VSIX is intentionally ignored by Git.

### 2. Set the version

Read the current version:

```powershell
npm pkg get version
```

For the first release, keep `0.0.1`; do not bump merely because a package was
built locally.

For a future patch release, use the repository helper:

```powershell
npm run version:build
```

That command updates `package.json`, `package-lock.json`, and the static Visual
Studio Marketplace badge in `README.md`. It does not create a commit or tag.

For an explicit minor, major, or specific version, use npm without automatic
Git changes:

```powershell
npm version 0.1.0 --no-git-tag-version
```

After an explicit version set, manually synchronize the version shown in the
Visual Studio Marketplace badge in `README.md`.

Verify the three synchronized version locations:

```powershell
npm pkg get version
node -p "require('./package-lock.json').version"
Select-String -Path README.md -Pattern 'VS Marketplace v'
```

### 3. Finalize the changelog

In `CHANGELOG.md`:

1. Leave an empty `## [Unreleased]` section for future work.
2. Add a heading such as `## [0.0.2] - 2026-08-08` below it.
3. Move the release's entries under that version.
4. Update the comparison and version links at the bottom.
5. Confirm the changelog version equals `package.json`.

Do not reuse a version that has already been uploaded to either registry.

### 4. Run the release checks

From the repository root, use this order:

```powershell
npm ci
npm run compile-tests
npm run compile
npm test
npm run lint
npm run package:vsix
```

Expected results:

- Dependency installation succeeds from `package-lock.json`.
- TypeScript test compilation succeeds.
- Webpack produces `dist/extension.js`.
- All unit tests pass.
- ESLint reports no errors.
- `@vscode/vsce` reports `DONE Packaged: mwnn-kanban.vsix` without a
  marketplace-blocking warning.

The packaging command runs `vscode:prepublish`, so the VSIX contains the
production-minified bundle even if `npm run compile` was run earlier.

### 5. Inspect the artifact

Record its size and checksum:

```powershell
Get-Item .\mwnn-kanban.vsix | Select-Object Name, Length, LastWriteTime
Get-FileHash .\mwnn-kanban.vsix -Algorithm SHA256
```

Review the file list printed by `npm run package:vsix`. The package should
contain the extension manifest, `dist/extension.js`, license, README,
changelog, and required `media/` assets. It should not contain source files,
tests, `node_modules`, source maps, repository automation, tokens, or local
board data.

### 6. Smoke-test the VSIX

Install the exact artifact into a dedicated VS Code profile:

```powershell
code --profile 'MWNN Release Smoke' --install-extension .\mwnn-kanban.vsix --force
code --profile 'MWNN Release Smoke' .
```

In that profile:

- Run `MWNN Kanban: Open Board`.
- Confirm the board loads with Backlog, Ready, In Progress, Verify, and Done.
- Add, edit, move, and delete a disposable card.
- Close and reopen the board to confirm persistence.
- Confirm the Activity Bar icon and board webview assets render.
- Exercise any release-specific behavior that changed.
- Check the Extension Host and developer-console logs for unexpected errors.

Do not publish an artifact different from the one that passed this smoke test.

## Publish with GitHub Actions

This is the recommended path.

### 1. Commit the release

Review the release diff:

```powershell
git status --short
git diff --check
git diff
```

Stage only intended files. For the current initial release preparation, the
expected release files are:

```powershell
git add .github/workflows/release.yml .vscodeignore CHANGELOG.md README.md docs/PUBLISHING.md package.json package-lock.json scripts/bump-package-version.cjs
git status --short
git diff --cached
git commit -m 'chore: prepare v0.0.1 release'
```

If a listed file did not change, Git simply leaves it unstaged. If your branch
requires a pull request, push the branch and merge the reviewed PR before
tagging:

```powershell
$branch = git branch --show-current
git push origin $branch
```

### 2. Create and push the release tag

Read the version from the committed manifest and create the matching annotated
tag:

```powershell
$version = node -p "require('./package.json').version"
git status --short
git tag -a "v$version" -m "MWNN Kanban v$version"
git push origin "v$version"
```

The tag must be exactly `v` plus the manifest version. The workflow rejects a
tag such as `v0.0.2` when `package.json` still says `0.0.1`.

Pushing the tag immediately starts publishing. Confirm the secrets and release
commit before running `git push origin "v$version"`.

### 3. Monitor the workflow

In GitHub, open **Actions → Release extension** and select the tag run. The
expected jobs are:

1. **Validate and package** — installs dependencies, compiles, tests, lints,
   packages, and uploads `mwnn-kanban.vsix` as a workflow artifact.
2. **Publish to VS Marketplace** — downloads that artifact and publishes it
   using `VSCE_PAT`.
3. **Publish to Open VSX** — downloads the same artifact and publishes it using
   `OVSX_PAT`.

The two publishing jobs are independent after packaging. If only one registry
job fails, rerun the failed job after correcting its account, secret, or
registry issue. Do not bump the version while recovering the unpublished
registry.

### Manual workflow dispatch

Use manual dispatch only when you intentionally want to publish the version in
a selected branch or commit without pushing a tag:

1. Open **Actions → Release extension**.
2. Select **Run workflow**.
3. Select the branch containing the exact release commit.
4. Recheck `package.json` and confirm that version is not already published.
5. Run the workflow and monitor all three jobs.

Manual dispatch publishes to both registries; it is not a package-only dry run.
Unlike a tag run, it cannot compare a tag name with the manifest version.

## Publish locally as a fallback

Use this path if GitHub Actions is unavailable or if you must recover one
registry manually. First rebuild and recheck the exact artifact:

```powershell
npm run package:vsix
Get-FileHash .\mwnn-kanban.vsix -Algorithm SHA256
```

Read both tokens without placing their values in command history:

```powershell
$secureVsceToken = Read-Host 'Visual Studio Marketplace token' -AsSecureString
$secureOvsxToken = Read-Host 'Open VSX token' -AsSecureString
$env:VSCE_PAT = [System.Net.NetworkCredential]::new('', $secureVsceToken).Password
$env:OVSX_PAT = [System.Net.NetworkCredential]::new('', $secureOvsxToken).Password
```

Publish the same file to the Visual Studio Marketplace first:

```powershell
npx --yes @vscode/vsce publish --packagePath .\mwnn-kanban.vsix -p $env:VSCE_PAT
```

Then publish that unchanged file to Open VSX:

```powershell
npx --yes ovsx publish .\mwnn-kanban.vsix -p $env:OVSX_PAT
```

Clear the session values when finished:

```powershell
Remove-Item Env:VSCE_PAT, Env:OVSX_PAT
Remove-Variable secureVsceToken, secureOvsxToken
```

If the first publish succeeds and the second fails, do not republish the first
registry and do not change the artifact or version. Correct the Open VSX issue
and retry only its command with the original VSIX.

## Verify the published release

### Registry listings

Open both public pages:

- Visual Studio Marketplace:
  `https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.mwnn-kanban`
- Open VSX:
  `https://open-vsx.org/extension/darrenjmcleod/mwnn-kanban`

On each listing, verify:

- Publisher, extension name, display name, and version.
- Description, README, changelog, license, icon, repository, and issue links.
- Install action and supported VS Code version.
- No broken images or unexpected files/content.

Open VSX initially shows a newly uploaded extension as deactivated while its
asynchronous scans run. Wait for processing to finish and confirm that the
extension becomes active and publicly searchable.

### Installation verification

Install from the Visual Studio Marketplace into the smoke profile:

```powershell
code --profile 'MWNN Release Smoke' --install-extension darrenjmcleod.mwnn-kanban --force
code --profile 'MWNN Release Smoke' --list-extensions --show-versions | Select-String 'darrenjmcleod.mwnn-kanban'
```

If VSCodium is installed, verify the Open VSX copy separately:

```powershell
codium --install-extension darrenjmcleod.mwnn-kanban --force
codium --list-extensions --show-versions | Select-String 'darrenjmcleod.mwnn-kanban'
```

Repeat the core board smoke test against the installed marketplace version.

### Optional GitHub release

A GitHub release is useful for release notes and an independently downloadable
VSIX, but it is not required by either extension registry. If the GitHub CLI is
installed and authenticated:

```powershell
$version = node -p "require('./package.json').version"
gh release create "v$version" .\mwnn-kanban.vsix --title "MWNN Kanban v$version" --notes-from-tag
```

Upload the exact VSIX that was published and record its SHA-256 checksum in the
release notes or internal release record.

## Future releases

For every later release:

1. Confirm the latest versions currently present in both registries.
2. Choose a new SemVer version; never reuse an uploaded version.
3. Run `npm run version:build` for a patch or the explicit `npm version ...
--no-git-tag-version` flow for another version.
4. Synchronize the README badge and finalize `CHANGELOG.md`.
5. Run all validation and smoke-test steps.
6. Commit and merge the release changes.
7. Create and push the exact matching `v<version>` tag.
8. Verify both registry jobs and both public listings.

The current workflow publishes stable releases. It does not add
`--pre-release`. Introduce a documented pre-release versioning policy and
update both registry jobs before attempting a pre-release.

## Troubleshooting

### The tag/version check fails

The pushed tag and `package.json` disagree. Do not force-move a public release
tag casually. Correct the release commit/version, create the intended tag, and
push only after confirming the manifest.

### `VSCE_PAT` or `OVSX_PAT` is not configured

The workflow intentionally fails before calling a registry when a secret is
empty. Add or replace the correctly named repository secret, then rerun only
the failed job or workflow.

### Visual Studio Marketplace returns 401 or 403

Check all of the following:

- The token has not expired or been revoked.
- The token applies to **All accessible organizations**.
- The token includes **Marketplace (Manage)**.
- The Microsoft identity is authorized on publisher `darrenjmcleod`.
- The publisher ID in `package.json` is unchanged.
- The December 1, 2026 global-PAT retirement has not taken effect.

### Open VSX rejects the publish

Confirm that:

- The Eclipse account and GitHub account are linked.
- The Eclipse Publisher Agreement has been accepted.
- The token is valid and was copied completely.
- The `darrenjmcleod` namespace exists and the account can publish to it.
- The server-side secret, blocklist, and namespace-similarity scans pass.

Use this non-destructive token check:

```powershell
npx --yes ovsx verify-pat darrenjmcleod -p $env:OVSX_PAT
```

### The version already exists

Registries do not allow replacing an uploaded version. If the same artifact is
already present, verify it and stop. If code or metadata must change, create a
new patch version, rebuild, retest, and publish that version to both registries.

### One registry succeeded and the other failed

Keep the successful registry untouched. Preserve the original VSIX and
checksum, correct the failed registry's issue, and retry only that publish job
or local command. Both registries should end with the same version and bytes.

### Packaging contains unexpected files

Inspect `.vscodeignore`, correct the smallest exclusion rule, and rerun
`npm run package:vsix`. Never publish a package containing tokens, `.env`
files, local board state, development logs, tests, source maps, or unnecessary
dependencies.

### Marketplace rejects README or image content

The Visual Studio Marketplace requires HTTPS image URLs and restricts SVGs in
README/changelog content. Keep the extension icon as a packaged PNG and use
trusted badge providers. Repackage after correcting the documentation.

### Server-side secret scanning reports a false positive

Inspect the exact packaged file and finding. Remove real secrets immediately.
Use a scanner-specific suppression only for a verified false positive and only
as narrowly as the registry documentation permits. Never bypass secret checks
merely to complete a release.

## Migrate VS Marketplace publishing to Microsoft Entra ID

The current `.github/workflows/release.yml` uses `VSCE_PAT`, which is a
temporary path because global Azure DevOps PATs retire on December 1, 2026.

Before that date:

1. Review Microsoft's current secure automated publishing documentation.
2. Create the required user-assigned managed identity and workload identity
   federation configuration.
3. Grant the identity access to the publishing pipeline.
4. Add the managed identity to publisher `darrenjmcleod` with the Contributor
   role.
5. Configure the supported Azure-authenticated pipeline to obtain an Entra ID
   access token.
6. Change the Visual Studio Marketplace publish command to use:

   ```powershell
   npx --yes @vscode/vsce publish --packagePath .\mwnn-kanban.vsix --azure-credential
   ```

7. Test the new identity path with a new extension version before removing
   `VSCE_PAT`.
8. Remove and revoke the old Marketplace PAT after the replacement succeeds.

Open VSX uses its own access token and is not changed by the Marketplace Entra
ID migration.

## Recovery and rollback guidance

Prefer publishing a corrected higher patch version over removing an extension.
Removing a Visual Studio Marketplace extension is irreversible, removes its
statistics, and permanently reserves the extension name. Unpublishing is less
destructive but still affects users and availability. Use registry management
portals only after confirming the exact extension/version and documenting the
reason.

Never delete or move release tags, remove marketplace versions, revoke working
credentials, or unpublish an extension as an automatic response to a failed
second-registry publish.

## Final release checklist

- [ ] `package.json` has the intended new version.
- [ ] `package-lock.json` root versions match.
- [ ] The Visual Studio Marketplace badge matches.
- [ ] `CHANGELOG.md` contains the dated version entry.
- [ ] The Marketplace publisher exists and the publishing identity is allowed.
- [ ] The Open VSX agreement is signed and namespace exists.
- [ ] `VSCE_PAT` and `OVSX_PAT` are configured, current, and unexposed.
- [ ] `npm ci` succeeds.
- [ ] Test compilation and extension compilation succeed.
- [ ] All tests pass.
- [ ] Lint passes.
- [ ] `mwnn-kanban.vsix` packages without blocking warnings.
- [ ] The VSIX file list, size, and SHA-256 were reviewed.
- [ ] The exact VSIX passed a Development Host/profile smoke test.
- [ ] The release changes are committed and merged.
- [ ] The pushed tag exactly matches `v<package.json version>`.
- [ ] All three GitHub workflow jobs succeed.
- [ ] Both public listings show the expected version and metadata.
- [ ] Installation from both registries was verified.
- [ ] Tokens and any temporary environment variables were cleared or rotated
      as appropriate.
- [ ] The Entra ID migration is complete before December 1, 2026.

## Official references

- [Visual Studio Code: Publishing
  Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Visual Studio Code: Continuous
  Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Visual Studio Marketplace publisher
  management](https://marketplace.visualstudio.com/manage/publishers/)
- [Open VSX: Publishing
  Extensions](https://github.com/EclipseFdn/open-vsx.org/wiki/Publishing-Extensions)
- [Open VSX registry](https://open-vsx.org/)
