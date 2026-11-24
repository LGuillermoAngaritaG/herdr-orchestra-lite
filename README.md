# Orchestra Lite for Herdr

A panel for [Herdr](https://herdr.dev) that runs a small team of coding agents. You give one goal to an orchestrator. It splits the goal into tasks, starts a worker for each task, and has one reviewer check all the work at the end.

Each role can run **Claude Code** or **Pi**. Pi can use local models (Ollama, LM Studio, vLLM) or any provider you have logged in to.

This is a trimmed version of the Orchestra panel from [LGuillermoAngaritaG/herdr-config](https://github.com/LGuillermoAngaritaG/herdr-config). It drops Council mode, Codex, Antigravity and the usage limits, and it fixes Pi helpers that fail to start.

## Roles

| Role | What it does | Tools |
|---|---|---|
| Orchestrator | Plans, starts helpers, judges the review, reports to you. Never edits code. | Claude: Bash only, and only `hc` and `git worktree` run without asking. Pi: `bash` only. |
| Worker | Does one task. Runs in its own git worktree when workers run in parallel. | Full |
| Reviewer | Starts once every worker has reported. Reviews all the work together and edits nothing. | Full, but its instructions forbid edits |

The orchestrator runs at most 3 workers at a time. It shows you the plan before any worker changes files. It never merges into your branch. You get a branch `orch/<goal>` to review and merge.

## Requirements

- macOS, with Herdr installed and opened at least once
- Python 3 (`python3`)
- At least one of these agents:
  - Claude Code (`claude`), logged in
  - Pi (`npm install -g @mariozechner/pi-coding-agent`) with at least one model. Check with `pi --list-models`.

## Install

```sh
./install.sh
```

The script copies `mods/orchestra-lite` into `~/.config/herdr-app/mods/` and checks it. Herdr docks the panel on the right side of the window. Run it again to update.

To remove the panel, delete `~/.config/herdr-app/mods/orchestra-lite` and the `lite-*.md` files in `~/.config/herdr-core/templates/`.

## Use

1. For each role, pick an agent, a model and an effort level.
2. Press **Start orchestrator**. A new tab opens with the orchestrator.
3. Tell it the goal. Approve its plan. Wait for its final report.

Press **Reload** after you install an agent or add a Pi model.

## Using Pi

The panel lists every model from `pi --list-models`: local models from `~/.pi/agent/models.json` and providers you have logged in to with `pi auth`. Effort levels appear only for models that support thinking.

A local model example for `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "qwen3-coder:30b", "reasoning": true, "contextWindow": 131072 }]
    }
  }
}
```

The local server must be running before you press Start.

### Why Pi failed before

Herdr starts helpers with its own PATH. That PATH often lacks the folder where npm installs global packages (`~/.npm-global/bin`, nvm, Volta). Pi helpers then died at once with exit code 127, "command not found", and the orchestrator waited for reports that never came.

Orchestra Lite reads the PATH of your login shell when the panel loads. It starts every agent with that PATH and with the agent's full path, so Pi, `node` and `hc` are always found.

## How it works

| File | What it does |
|---|---|
| `mods/orchestra-lite/main.js` | The panel. It saves your picks, writes the helper templates, and opens the orchestrator tab. |
| `mods/orchestra-lite/agents.py` | Finds `claude` and `pi` and your login shell's PATH, and lists Pi's models. |
| `mods/orchestra-lite/mod.json` | Docks the panel on the right, 320 px wide. |

For a tab bar button that shows and hides the panel, give the panel block the id `orch` in your layout. Then add a block with `{"mod": "orchestra-lite", "props": {"button": true}}` next to the `tabs` block.

The panel writes two templates, `lite-worker` and `lite-reviewer`, to `~/.config/herdr-core/templates/`. The orchestrator starts helpers from them with `hc run`. Helpers report back with `hc send`. The template names differ from the original Orchestra panel's, so both panels can be installed at once.

## Limits

- Only the Claude Code orchestrator is locked out of editing files. A Pi orchestrator has only `bash`, so it could still edit files through shell commands. Only its instructions stop it.
- Claude models are listed by alias (Opus, Fable, Sonnet, Haiku), so you always get the latest version of each.
- If you change your shell's PATH, press **Reload** so the panel reads it again.
