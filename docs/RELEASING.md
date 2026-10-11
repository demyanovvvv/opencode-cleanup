# Releasing

## Prepare

1. Review the diff and known limitations. Do not describe incomplete interfaces as finished features.
2. Choose a semantic version and update `package.json` and the root package entries in `package-lock.json` together.
3. Add an accurate dated entry to `CHANGELOG.md`. Keep version history out of both README files.
4. Run `npm ci`, `npm run check`, `npm run test:tui`, `npm run smoke:worker` and `npm run smoke:installer`.
5. Run `npm run release:prepare` after the verified build. It packs the package, checks installation/removal using temporary configuration and data directories, creates a ZIP, verifies extracted ZIP contents and writes SHA-256 checksums under `release-artifacts/`. On Linux/macOS this requires `tar`, `zip` and `unzip`; Windows uses `tar` and PowerShell 7.

## Assets

Publish a `.tgz` package, an installable ZIP containing the same package contents, and `SHA256SUMS.txt`. The ZIP must contain `dist/`, the setup script, Windows launchers, package metadata and documentation. A GitHub source archive alone does not contain ignored build output.

The package is distributed through GitHub Releases. npm registry publication is a separate decision and is not configured by this procedure.

## Publish

Review `git status`, the staged diff and recent history. Commit intended source files only, push the branch, and confirm CI succeeds. Create an annotated `v<version>` tag on the verified commit and push it. Create the GitHub Release with `gh release create --verify-tag`, release notes and all three assets. Confirm the tag, published state and asset checksums after uploading.

Use an authenticated account with repository access. Do not commit authentication tokens or change global Git identity for a release. For a private repository, only authorized users can download its assets.
