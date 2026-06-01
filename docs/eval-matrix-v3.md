# Eval Matrix v3

Canonical agent eval layers for manage_robot. Replaces 18 overlapping `eval:*` scripts.

## Commands

| Layer | Command | LLM | When |
|-------|---------|-----|------|
| L0 | `npm run eval:unit` | No | Every PR |
| L1 | `npm run eval:integration` | Mock | PR / weekly |
| L2 | `npm run eval:spot` | Yes | Debug; `EVAL_TAG=assignment\|portfolio\|misc\|read-url\|roles\|wbs-domain\|all` |
| L3 | `npm run eval:chains` | Yes | Fixture changes; `EVAL_CHAIN_GROUP=core\|portfolio\|cross\|all` |
| L4 | `npm run eval:release` | Yes | Nightly / pre-release |

## Release critical gate

Exit 1 when any of these fail:

- `eval:unit`
- `portfolio-regression`
- `chains-core` (6 natural-language chains, 28 turns)

Other release stages (portfolio chains, cross-channel, meeting-import) warn only unless `EVAL_STRICT_ALL=1`.

## Deprecated aliases

| Old | New |
|-----|-----|
| `eval:deployment-parity` | `eval:release` |
| `eval:natural-full` | `eval:chains` (core) |
| `eval:replay-transport` | `eval:chains` + `EVAL_CHAIN_FILTER=chain_transport` |

## Fixture registry

[`fixtures/eval-v3/manifest.json`](../fixtures/eval-v3/manifest.json)

## Reports

Unified schema: [`docs/eval-report-schema-v1.md`](eval-report-schema-v1.md)

History: `data/eval-history/eval-runs.jsonl` — compare with `npm run eval:compare -- --baseline=YYYY-MM-DD --current=latest`

## Legacy docs

See also (historical): `eval-natural-full-plan.md`, `eval-project-portfolio-plan.md`, `eval-portfolio-full-plan.md`
