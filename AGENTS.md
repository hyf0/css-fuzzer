# AGENTS.md

- This repository is a strongly typed TypeScript CSS parser fuzzer. The fuzzer core, generators, adapters, runner, and minimizer should stay in TypeScript with `strict` compiler settings.
- Use `vp install`, `vp check`, `vp test`, and `vp run` for JavaScript and TypeScript workflows.
- Treat parser disagreements as untriaged findings until they are minimized and replayed. Do not call a case a parser bug only from one raw fuzz input.
- Keep generated crash reports and large downloaded spec HTML out of git unless a human explicitly asks to check in a snapshot.
- The sibling checkout `../oxc-css-parser` is an input dependency for the local OXC driver. Do not edit that repository from this fuzzer unless the task explicitly changes to fixing OXC itself.
- Write persistent project context in `.agents/docs/` when it explains why the fuzzer is built a certain way.

## Project Context Records (PCR)

This project follows **Project Context Records (PCR)** —
methodology: https://github.com/hyf0/project-context-records. PCR keeps the
project's durable design context — the *why*, the decisions, the architecture —
so you inherit it instead of re-deriving or re-litigating what's already settled.

When working here:
- **Where they live.** Records are in `.agents/docs/` — one topic per file,
  cross-linked with relative Markdown links (`[name](./name.md)`).
- **Read first.** If a record covers the area you're touching, read it before acting.
- **Record as you go.** Proactively write down context worth keeping — and whenever
  a human asks you to. No required format, no fixed list of what qualifies: if it's
  true about this project, not visible in the code, and useful beyond the moment,
  it's worth a record.
- **Keep it fresh.** If your change affects a record, update it in the same change —
  a stale record is a trap, not an asset.
- **Provenance.** An unstamped line is AI-accumulated: challenge and verify it freely.
  A `[VOUCHED @handle]` stamp (on a line, or at the top of a file) means a human
  vouched for it — treat it as settled; reopen or re-verify only on new evidence, a
  changed constraint, or a human's say-so. Add a stamp only on a human's explicit
  instruction; reading past a line, or not objecting, is not a stamp.
