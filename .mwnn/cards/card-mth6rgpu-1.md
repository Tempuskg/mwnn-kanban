---
id: card-mth6rgpu-1
title: Update GH_PACKAGES_TOKEN for GitHub Packages CI
column: col-mqwk2njn-4
position: -25000
assignee: { kind: human }
createdAt: 1788177581922
updatedAt: 1788186671563
---

## Description
Follow the `Update GH_PACKAGES_TOKEN` section in `docs/PUBLISHING.md` to
restore GitHub Packages access for `.github/workflows/ci.yml` and
`.github/workflows/release.yml`. The secret allows `npm ci` to download
`@tempuskg/mwnn-kanban-pro` from `https://npm.pkg.github.com`; it is not runtime
extension configuration and must never be committed to `.npmrc`, files, logs,
issues, or chat.

### Detailed procedure

1. Create a replacement before revoking the old token. Use **Profile → Settings
   → Developer settings → Personal access tokens → Tokens (classic) → Generate
   new token (classic)**. Use a descriptive name and an expiration that can be
   monitored.
2. Grant the least privilege: `read:packages` is required. Add `repo` only if
   the package is private or its access is inherited from a private repository
   and GitHub requires repository-scoped access. Do not grant
   `write:packages` or `delete:packages`. If `Tempuskg` requires SAML SSO,
   authorize the new classic token through **Configure SSO**.
3. In `Tempuskg/mwnn-kanban`, open **Settings → Secrets and variables → Actions
   → Secrets**. Update or create the repository secret named exactly
   `GH_PACKAGES_TOKEN`; paste the replacement without quotes or whitespace.
   Do not use a repository variable or a differently named environment secret.
4. Optionally update it with GitHub CLI without putting the value in command
   history:

   ```powershell
   $secureToken = Read-Host 'GitHub Packages token' -AsSecureString
   $token = [System.Net.NetworkCredential]::new('', $secureToken).Password
   try {
     $token | gh secret set GH_PACKAGES_TOKEN --repo Tempuskg/mwnn-kanban
   } finally {
     Remove-Variable token, secureToken -ErrorAction SilentlyContinue
   }
   gh secret list --repo Tempuskg/mwnn-kanban | Select-String 'GH_PACKAGES_TOKEN'
   ```

5. Validate the replacement without changing the repository. Read the token
   with `Read-Host -AsSecureString`, put only the `${NODE_AUTH_TOKEN}` reference
   in a temporary npmrc created by `New-TemporaryFile`, set
   `$env:NODE_AUTH_TOKEN` and `$env:NPM_CONFIG_USERCONFIG`, then run:

   ```powershell
   npm view '@tempuskg/mwnn-kanban-pro' version --registry=https://npm.pkg.github.com
   ```

   Remove the temporary npmrc and both environment variables in `finally`.
   An `E401` indicates an invalid, expired, revoked, non-classic, or
   unauthorized token; `E403` indicates insufficient package access; `E404`
   may indicate a package, scope, registry, or permission mismatch.
6. If a release's **Validate and package** job failed, rerun the whole workflow
   after updating the secret because both registry jobs were skipped:

   ```powershell
   gh run rerun <run-id> --repo Tempuskg/mwnn-kanban
   gh run watch <run-id> --repo Tempuskg/mwnn-kanban --exit-status
   ```

   Do not create a new version or move the release tag for a token failure. If
   only one registry job failed after packaging passed, retry only that job and
   preserve the original VSIX.
7. For planned rotation, revoke the old token only after the replacement and a
   workflow run succeed. If exposure is suspected, revoke immediately, create
   and install a replacement, then review workflow logs and repository history.

## Acceptance criteria
- [x] A replacement personal access token (classic) is created with
      `read:packages`, optional narrowly justified `repo`, an expiry, and SSO
      authorization when required.
- [x] The repository Actions secret is named exactly `GH_PACKAGES_TOKEN` and is
      updated without exposing the token in files, logs, issues, or history.
- [x] `gh secret list --repo Tempuskg/mwnn-kanban` confirms the secret name
      without printing its value.
- [x] The temporary npm configuration check returns an accessible
      `@tempuskg/mwnn-kanban-pro` version and cleans up its token environment
      variables and temporary file.
- [x] The failed package workflow is rerun without changing the release version
      or tag, and **Validate and package** passes before registry publication is
      considered complete.
- [x] The old token is revoked after successful rotation, or immediately when
      exposure is suspected.

## Activity
### STATUS: DONE
