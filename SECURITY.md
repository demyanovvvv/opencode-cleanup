# Security policy

## Supported release

Security fixes target the latest release. See [compatibility](docs/COMPATIBILITY.md) for the tested runtime and schema baseline.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/demyanovvvv/opencode-cleanup/security/advisories/new) when that feature is available for the repository. If it is unavailable, contact the repository owner through an existing private channel or a restricted repository issue accessible only to trusted collaborators. Do not disclose a vulnerability in a public issue.

Include affected code, the impact, reproducible steps and a minimal synthetic fixture. Do not attach a real OpenCode database, conversation archive, credentials or tokens. Discuss sensitive evidence privately with the maintainer before sharing it.

This project processes local conversation history and executes database maintenance. Reports involving archive verification, path traversal, symlinks, stale-plan validation, worker lifecycle or unintended data deletion are especially relevant.
