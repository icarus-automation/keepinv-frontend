# Claude Code Project Instructions

## Required Project Rules

Before making changes, read and follow:

- `.claude/rules/angular-best-practices.md`

## Skills

Project-specific skills are located in:

- `.claude/skills`

Use the relevant skill when the task matches the skill description.

## PR Review Behavior

During PR reviews:

* focus on correctness
* detect regressions
* detect breaking changes
* identify performance concerns
* identify security concerns
* identify maintainability issues
* suggest concise improvements

## PR Review Behavior

During PR reviews, DO NOT raise comments for:

* Missing unit tests, integration tests, e2e tests. As this project currently not following strict TDD workflow.
* graphify-out/** generated artifacts and are intentionally committed to the repo.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
