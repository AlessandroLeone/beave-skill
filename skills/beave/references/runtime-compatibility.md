# Runtime Compatibility

Design support by agent runtime, not by model name. Models change more often than their host's skill, filesystem, permission, and process interfaces.

## Supported runtime profiles

| Runtime | Native location | Hybrid engine | Distribution |
|---|---|---|---|
| OpenAI Codex local | `.agents/skills/beave/` | full when shell and project files are available | repository/user skill; later OpenAI plugin |
| ChatGPT surfaces | installed skill/plugin where supported | conditional; local project state is not assumed | semantic skill or plugin; portable fallback |
| Claude Code | `.claude/skills/beave/` | full when the Beave CLI and file permissions are available | Claude skill/plugin adapter |
| Gemini CLI | `.agents/skills/beave/` or `.gemini/skills/beave/` | full after activation consent and shell/file permission | Git/`.skill`/extension adapter |
| Antigravity / AGY | workspace skill loaded with the approved project context | full when the local command is permitted | workspace adapter |
| Other AI systems | attach or paste `beave-portable.md` | unavailable unless the host can call the CLI | one self-contained Markdown file |

The same canonical semantic content serves every runtime. Exporters adapt paths, metadata, invocation syntax, and declared capabilities; they must not fork the workflow or questionnaire.

## Capability negotiation

Before selecting Hybrid, verify:

1. a local filesystem and the Beave CLI on Node 24 LTS are available; Node 22 may be accepted only when the current compatibility matrix says so, and Python 3.11+ is a temporary alpha bridge;
2. the runtime can run a local process and read its concise output;
3. the user approved the persistence location;
4. the selected agent has only the permissions needed for the current command;
5. any future project-agent capabilities referenced in generated prompts exist in the later execution runtime; Beave initialization itself does not invoke them.

If any requirement fails, use Semantic-only. Never install dependencies or enable MCP merely to avoid the fallback.

The TypeScript/Node CLI is the only canonical programmatic engine. The bundled Python implementation is frozen as an alpha bridge: do not add independent behavior to it, expose command differences explicitly, and remove it before beta only after saved-state migration and parity evidence.

## Runtime-specific cautions

- Codex and Gemini can share `.agents/skills/beave`; avoid installing a second copy with the same name at a higher-precedence scope.
- Claude Code uses `.claude/skills/` and has runtime-specific frontmatter and plugin features. Generate its adapter instead of editing the canonical skill.
- Gemini extension subagents may be preview features. Beave generates future worker briefs without invoking or promising native orchestration.
- ChatGPT web/cloud cannot be assumed to see a user's local `.beave/` state. Use the portable flow or a separately approved future connector.
- A model/effort recommendation is advisory until the host confirms that exact option is available.

## Primary documentation

- OpenAI: https://developers.openai.com/codex/skills
- Anthropic: https://code.claude.com/docs/en/skills
- Google Gemini CLI: https://geminicli.com/docs/cli/creating-skills/

Verify these sources at release time because runtime behavior is version-sensitive.
