# Investigations with REA (developer workflow)

This is a development tool for the people building Kinviva. It is **not** part of the app, is not bundled in the installer, and end users cannot reach it.

## Setup (once, in Claude Code)
REA is the open-source MCP server at https://github.com/morluto/rea (MIT licence, npm package `rea-agents`). The Claude Code configuration on the maintainer's Mac already has it as the `rea` MCP server, pinned to `rea-agents@6.7.0` (`npx -y rea-agents@6.7.0 mcp`). It needs Node 22.23.4+, 24.22.1+ or 26.12.1+ (this Mac runs 26.13.0).

Rules for the setup:
- Pin the version. Read the release notes before changing the pin.
- Do not install optional native analysers (Hopper, Ghidra, IDA) unless a specific investigation needs one and the maintainer approves.
- To set it up on a new machine, review the package first, then run `npx rea-agents setup` and check the changes it asks for before accepting them.
- Check it works: in Claude Code the tools named `mcp__rea__*` should be listed.

## Running an investigation
Use the `/investigate` command in Claude Code (`.claude/commands/investigate.md`) with a research question and a target you are authorized to examine.

```
Request -> authorization check -> REA (read-only) -> evidence -> behaviour analysis -> design spec -> independent implementation -> tests
```

Every report is a file in `docs/investigations/` with: research question, target and authorization, tools used, observations (with evidence ids), verified facts, reasonable inferences, unknowns and limits, recommended independent implementation, and how to reproduce.

## Allowed and not allowed
Allowed: your own builds, open-source software, and software you have written permission to examine. Read-only static inspection first; conventional profilers and source-level debugging before any runtime tool.
Not allowed: bypassing licences, authentication, DRM, anti-tamper or bot protection; analysing a service you may not test; copying proprietary code, assets, branding or algorithms. Inference is never recorded as verified fact. The Kinviva implementation is always written independently.

## Reports so far
- [001: why macOS keeps asking for permissions after an update](investigations/001-signing-and-permission-prompts.md)
