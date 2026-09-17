# Repository Working Rules

## Clean committed baseline

Feature work and revisions must start from a clean committed repository state.

Before implementation:

1. Run `git status --short` and stop if tracked or untracked project files are pending.
2. Commit the completed prior work before beginning the next feature or revision.
3. Record the starting commit with `git rev-parse HEAD`.
4. Do not combine unrelated unfinished work with a new implementation.

During implementation:

1. Keep each approved feature or cohesive approved batch independently reviewable.
2. Preserve unrelated user changes.
3. Run the smallest relevant existing validation before committing.
4. Do not begin the next feature while the current feature remains uncommitted.

For the 81-item editor UX plan in `editor/docs/ux-plan-81-revised.md`, every item requires explicit user approval before implementation. Approval of one item does not imply approval of another item or an entire section.
