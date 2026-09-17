# Plangonaut

Plangonaut prepares a complete multidisciplinary project folder: specifications, decisions, resources, execution strategy, agents where useful, tasks, verification, recovery and completion conditions. It asks all necessary questions without a total question or document cap.

## Semantic and programmatic use

- **Semantic-only:** provide the Markdown skill and references or Portable Edition. The host AI produces the complete project through approved file tools or manual delivery. No Plangonaut CLI, npm, executable, Git repository or Studio is required.
- **Hybrid:** the same semantic method plus the TypeScript/Node CLI for supported deterministic persistence, validation, versions and Resume. Completeness requirements are identical; mechanical guarantees differ.

A repository distributes/develops Plangonaut; npm/npx and a verified CLI executable distribute its programmatic capability. Installing the skill only makes its instructions discoverable. None of these supplies an AI model. The user's output folder need not be a software or npm project. Studio's optional desktop executable is separate from the CLI.

## Current alpha

Version 0.3.0-alpha.3 is **prepared but not published**: it is the version this source declares, and the newest one on npm is `0.3.0-alpha.2` under the `alpha` channel until a publication is authorised. It remains a prerelease, not a release-readiness claim. The CLI target is Node 24 without mandatory third-party runtime dependencies. A supported native Studio installer has not been published yet.

The CLI exposes installation, Portable/adapters, typed ledgers, structural gate prerequisites, governed document operations and digest-verified project handoff. Project-state mutations use caller operation IDs; document saves require the token returned by their reviewed preview, and interrupted file operations are recovered from a local journal. Structural success never certifies semantic completeness; read the engine guide before relying on a check.

## Start

Install the CLI from the explicit prerelease channel:

```sh
npm install --global plangonaut@alpha
plangonaut --version
plangonaut capabilities
```

Install the semantic skill into a project only after previewing its destination:

```sh
plangonaut install --target codex --scope project --project-root . --dry-run
plangonaut install --target codex --scope project --project-root .
plangonaut verify-install --target codex --scope project --project-root .
```

Use `claude`, `gemini` or `agy` in place of `codex` for another supported host. The complete skill ZIP and Portable Markdown edition are also available from [plangonaut.com/download.html](https://plangonaut.com/download.html#skill-cli).

Provide the skill/references or Portable Edition to the chosen host. Establish missing authority and persistence, inspect existing material and follow coverage through the complete agreed outcome. After initialization the same agent or a fresh execution system may proceed when authorized. Studio, board review and a model change are optional.

## Documentation

- [Semantic entry point](skills/plangonaut/SKILL.md)
- [User guide](skills/plangonaut/references/user-guide.md)
- [Coverage contract](skills/plangonaut/references/coverage-contract.md)
- [Execution package](skills/plangonaut/references/execution-package.md)
- [Engine capabilities and limits](skills/plangonaut/references/engine-contract.md)
- [Runtime and distribution](skills/plangonaut/references/runtime-compatibility.md)
- [Behavioral evaluation scenarios](tests/scenarios/complete-project-preparation.md)

## Ownership and boundaries

Public skill/core/CLI sources are Apache-2.0. Website and Studio source remain private. Base Studio reads, edits and visualizes project files; assisted review, linked-file change impact and reconciliation are future optional subscription features. Semantic/CLI handling of corrections remains free.

Plangonaut initialization prepares the future execution system and does not launch its agents. Publication, push, deployment, spending and external connections require their own authority.
