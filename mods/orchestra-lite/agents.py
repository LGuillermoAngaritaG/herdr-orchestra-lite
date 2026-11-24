#!/usr/bin/env python3
"""Prints what the panel needs to start Claude Code and Pi, as JSON:
{"path": "<login shell PATH>", "claude": {"bin", "models"}, "pi": {"bin", "models"}}.

Herdr starts programs with its own PATH, which often misses ~/.npm-global/bin, nvm and similar
folders. A Pi installed there then fails with "command not found" (exit 127). The panel starts
every agent with the PATH of the person's login shell, read here, so Pi, node and hc are found.
"""
import json
import os
import shutil
import subprocess

MARK = "__orchestra_lite_path__"


def login_path():
    shell = os.environ.get("SHELL") or "/bin/zsh"
    try:
        out = subprocess.run([shell, "-ilc", f"printf '\\n{MARK}%s\\n' \"$PATH\""], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL).stdout
        for line in out.splitlines():
            if line.startswith(MARK):
                return line[len(MARK):]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return os.environ.get("PATH", "")


CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

# ponytail: Claude Code has no command that lists models; its aliases always point at the latest.
CLAUDE = [
    {"id": "opus", "label": "Opus", "efforts": CLAUDE_EFFORTS},
    {"id": "fable", "label": "Fable", "efforts": CLAUDE_EFFORTS},
    {"id": "sonnet", "label": "Sonnet", "efforts": CLAUDE_EFFORTS},
    {"id": "haiku", "label": "Haiku", "efforts": CLAUDE_EFFORTS},
]

PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh"]


def pi_models(pi, path):
    """Every model Pi can use (local ones from models.json and logged-in providers), from pi --list-models."""
    try:
        out = subprocess.run([pi, "--list-models"], capture_output=True, text=True, timeout=60, env={**os.environ, "PATH": path}, stdin=subprocess.DEVNULL).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    models = []
    for line in out.splitlines()[1:]:
        cols = line.split()
        if len(cols) < 5:
            continue
        provider, model, thinking = cols[0], cols[1], cols[4]
        models.append({"id": f"{provider}/{model}", "label": model, "efforts": PI_EFFORTS if thinking == "yes" else []})
    return models


def main():
    path = login_path()
    claude = shutil.which("claude", path=path)
    pi = shutil.which("pi", path=path)
    print(json.dumps({
        "path": path,
        "claude": {"bin": claude, "models": CLAUDE if claude else []},
        "pi": {"bin": pi, "models": pi_models(pi, path) if pi else []},
    }))


if __name__ == "__main__":
    main()
