# GitHub Actions usage policy

GitHub-hosted Actions are a limited project resource. Use them only when automation provides clear value that cannot be achieved more cheaply through local checks.

## Rules

1. Run the complete local verification command before pushing changes:

   ```bash
   npm run ci
   ```

2. Automatic CI runs for pull requests only. It does not run again merely because an already-reviewed change is merged or pushed to `main`.
3. A newer commit to the same pull request cancels the older in-progress CI run.
4. Manual workflow dispatch is available for exceptional validation, not as the normal development loop.
5. Release automation runs only for an intentional version tag that exactly matches `manifest.json`.
6. Do not add scheduled workflows, operating-system or Node.js matrices, uploaded artifacts, repeated builds, or separate jobs unless the added coverage has a documented need.
7. Documentation-only, formatting-only, and routine repository-management work should not gain dedicated workflows.
8. Prefer one consolidated verification job over several jobs that each repeat checkout, dependency installation, or compilation.
9. Pin third-party actions to immutable commit SHAs.
10. Review expected runner usage before introducing or expanding any workflow.

## Acceptable exceptions

Additional automation may be justified for a required release, a security control, a platform-specific failure that cannot be reproduced locally, or a repository requirement imposed by Obsidian. Record the reason in the workflow or pull request when making an exception.
