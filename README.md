# Beave

Beave is a human-governed project operating system for AI-assisted work. One configured host AI collaborates with the user through an adaptive semantic skill and a deterministic local CLI, then produces the complete documents, plans, gates, memory, and optional multi-agent prompt system required to execute the project later.

Current design baseline: `0.2.0-alpha.1`. The local alpha is an implementation precursor and is **not safe or authorized for npm publication yet**; see the implementation handoff for known gaps.

## Two ways to use Beave

- **Hybrid:** recommended for projects spanning sessions, agents, contracts, or safety gates. The AI handles meaning and recommendations; the TypeScript/Node CLI is the canonical target for state, ledgers, document versions, gates, context, exports, recovery, and human overrides.
- **Semantic-only:** copy `dist/beave-portable.md` or install only `skills/beave`. No library is required, but state consistency and resume are manual.

## Interaction modes

- **Guided:** one question at a time, with explanations.
- **Standard:** balanced flow, up to two related questions. Default.
- **Expert:** deepest applicable investigation, edge-case challenges, and stronger evidence.

Question limits are per conversational turn, not per project. Beave keeps asking until every applicable area is confirmed or visibly deferred, even when that requires a long interview.

## Operating boundary

Beave does not spawn or execute a project's future agents. It decides with the user whether agents are useful, proposes their roles and relationships, and writes their prompts, permissions, dependencies, handoffs, and operating procedure into the project. A later AI session reads those artifacts and executes the prepared project.

These are separate from project modes such as `Genesis`, `Adoption`, `Reconstruction`, `Evolution`, and `Resume`.

## Local Get Started

```powershell
npm install
npm test
node bin/beave.mjs capabilities
```

Try the executable without a global install:

```powershell
npm exec -- beave capabilities
```

Create the package tarball and inspect its contents:

```powershell
npm pack --dry-run
```

Optional global development install, only when you explicitly want to change the machine:

```powershell
npm install --global C:\wamp64\www\beavelab
beave capabilities
npm config get prefix
```

On Windows, the prefix directory contains `beave.cmd` and must be on `PATH`.

After an authorized public implementation and publication, the intended commands are:

```powershell
npx @beavelab/beave@latest capabilities
npm install --global @beavelab/beave
beave resume --project-root C:\path\to\project
```

## Install the skill for an AI host

Preview before writing:

```powershell
beave install --target all --scope project --project-root C:\path\to\project --dry-run
```

Then remove `--dry-run` after reviewing the exact destinations. Codex and Gemini share `.agents/skills/beave`; Claude uses `.claude/skills/beave`.

## Documentation

- [Documentation index](docs/00_DOCUMENTATION_INDEX.md)
- [Approved blueprint](docs/PROJECT_BLUEPRINT.md)
- [Requirements](docs/REQUIREMENTS.md)
- [User guide](docs/USER_GUIDE.md)
- [Runtime guide](docs/RUNTIME_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data and safety](docs/DATA_AND_SAFETY.md)
- [Quality and acceptance](docs/QUALITY_AND_ACCEPTANCE.md)
- [Delivery and governance](docs/DELIVERY_AND_GOVERNANCE.md)
- [Implementation handoff](docs/IMPLEMENTATION_HANDOFF.md)
- [Open decisions](docs/OPEN_DECISIONS.md)
- [RexLab Resume pilot](docs/REXLAB_PILOT.md)
- [Roadmap](docs/ROADMAP.md)
- [Versioning](docs/VERSIONING.md)
- [Windows install and PATH](docs/WINDOWS_INSTALL.md)
- [Website](site/index.html)

## Repository policy

Public skill/core/CLI sources belong in `AlessandroLeone/beave-skill` under Apache-2.0. Website and Studio/Tauri sources remain in private `AlessandroLeone/beavelab`; signed freeware Desktop downloads are distributed through `beavelab.it`. No package publication, Git push, website deployment, signing, or external connector is performed automatically. BeaveLab remains release authority and the user can change direction by prompt; Beave records the override and reconciles downstream impact.
