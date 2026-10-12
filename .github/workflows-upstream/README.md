# Upstream workflows (disabled)

These are the GitHub Actions workflows from [morluto/rea](https://github.com/morluto/rea),
moved out of `.github/workflows/` so they do not run on this fork.

To re-enable them:

```bash
git mv .github/workflows-upstream .github/workflows
git rm .github/workflows/README.md
```

While they live here, the tests that check the workflow files fail
(`tests/boundary/filesystem/ciChangeScope.test.ts`, `releaseCheckpoint.test.ts`,
`releaseWorkflow.test.ts` and
`tests/conformance/providers/ghidra/realGhidraWindowsWorkflow.test.ts`).
