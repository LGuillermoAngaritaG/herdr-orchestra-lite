// Orchestra Lite: an orchestrator that splits a goal between workers, then one reviewer checks it all.
// Each role runs Claude Code or Pi with the model and effort picked here. Worker and reviewer become
// hc templates (lite-worker, lite-reviewer); Start opens the orchestrator in a new tab.
// Every agent starts with the login shell's PATH (from agents.py): Herdr's own PATH often misses
// where Pi and node live, and Pi then fails with "command not found".
// With props { button: true } it is the tab bar's button that shows and hides the panel (block "orch").

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, appHome, readTextFile, writeTextFile, theme, run, shared, setShared, checking, nextCommand, props, layout } from "herdr";

const AGENTS = [
  { id: "claude", label: "Claude Code" },
  { id: "pi", label: "Pi" },
];

const ROLES = [
  { id: "orchestrator", label: "Orchestrator", about: "Plans the work, starts helpers, never edits code." },
  { id: "worker", label: "Worker", about: "Does one task it is given." },
  { id: "reviewer", label: "Reviewer", about: "One review of all the work at the end, read-only." },
];

const DEFAULTS = {
  orchestrator: { agent: "claude", model: "opus", effort: "high" },
  worker: { agent: "claude", model: "sonnet", effort: "high" },
  reviewer: { agent: "claude", model: "opus", effort: "high" },
};

const ROLE_LABEL = "herdr.role";
const MAX_PARALLEL = 3;
const template = (role) => `lite-${role}`;

// The command line for a pick. The Claude orchestrator only has Bash, and only hc and git worktree
// run without asking. Pi has no per-command allowlist: its orchestrator only loses edit and write.
function argv(pick, role, catalog) {
  const env = ["env", `PATH=${catalog?.path ?? ""}`];
  const bin = catalog?.[pick.agent]?.bin ?? pick.agent;
  const lead = role === "orchestrator";
  if (pick.agent === "pi") {
    return [...env, bin, "--model", pick.model, ...(pick.effort ? ["--thinking", pick.effort] : []), ...(lead ? ["--tools", "bash"] : [])];
  }
  const lock = lead ? ["--permission-mode", "manual", "--tools", "Bash", "--allowedTools", "Bash(hc *)", "Bash(git worktree *)", "Bash(git -C * worktree *)", "Bash(printenv HC_TERMINAL_ID)",
    // hc exec and hc file run any command or edit any file: they would go around the lock.
    "--disallowedTools", "Bash(hc exec *)", "Bash(hc file *)"] : [];
  return [...env, bin, "--model", pick.model, ...(pick.effort ? ["--effort", pick.effort] : []), ...lock];
}

const describe = (pick) => `${AGENTS.find((a) => a.id === pick.agent)?.label} ${pick.model}${pick.effort ? ` (${pick.effort})` : ""}`;

const TEMPLATE_BODY = {
  worker: `You are a worker started by an orchestrator agent.
Do only the task you are given, in the folder you start in. Do not start other agents.
Keep changes small and focused. Run the relevant tests when you can.
Change only the files the task says you own. If you need to change another file, ask the orchestrator first.
If the task gives you a port, use only that port for servers you start.
If the task says you work in a git worktree, commit your changes on its branch before you report, and name the branch in the report.
When you finish or get stuck, report to the orchestrator with: hc send <its address> "<report>".
The report says what you did, which files you changed, and anything unfinished or uncertain. A reviewer will read it.
The task names the orchestrator's address.`,
  reviewer: `You are a reviewer started by an orchestrator agent.
You start after all the workers have finished. You get the goal, every task, and what each worker reported.
Later the orchestrator may send you fixes to recheck: then check only those fixes.
Check the actual results (the changed files, git diff, outputs), not only the reports. Do not edit files and do not start other agents.
Look for bugs, missing tests, conflicts between workers' changes, and anything that does not match the goal.
Report one review covering all tasks: findings ranked by severity per task, each with your advice, or say it all looks good. Send it with: hc send <orchestrator address> "<review>".
The task names the orchestrator's address.`,
};

function brief(picks) {
  return `You are now the ORCHESTRATOR. You only plan, delegate, check and report. Other agents do ALL the work.

Hard rules:
- Never do the work yourself: do not edit, create or delete files, do not write code, do not run builds or tests, do not read through the code to solve things.
- Even research is delegated: if you need to know how something works, start a worker to find out and report back.
- The only commands you run are hc commands and git worktree commands.
- Do not use your own built-in subagents. Use only the helpers below, started with hc.

First run these two commands, one at a time: printenv HC_TERMINAL_ID   (that is your address), then: hc label <your address> ${ROLE_LABEL}=orchestrator

Helpers (always --bg, a short unique --name, and your address so they can report back):
- worker (${describe(picks.worker)}): hc run --bg --rm --name w-<short> --cwd <folder> ${template("worker")} "<task brief>"
- reviewer (${describe(picks.reviewer)}): hc run --bg --rm --name review --cwd <folder> ${template("reviewer")} "Goal: <goal>. Tasks and worker reports: <each task, its worker, what it reported and where it changed things>. Orchestrator address: <your address>."
  Start exactly ONE reviewer, once, after every worker has reported.

Every task brief has these parts, each on its own line:
  Goal: <what to do, in one or two sentences>
  Done when: <a check anyone can run or see>
  Files you own: <the files or folders this worker may change; no two workers own the same file>
  Read first: <files or docs to read before starting>
  Do not: <what is out of scope>
  Report: send it with hc send <orchestrator address> "<report>"
  Orchestrator address: <your address>

How many workers: 1 for a question or a small change; 2 or 3 in parallel for independent parts; phases for bigger work. Never more than ${MAX_PARALLEL} at once.

Branches (in a git repo). Never merge into the user's branch; the user merges.
- One result branch for the goal: git -C <repo> worktree add ~/.herdr/worktrees/<repo name>/<goal slug> -b orch/<goal slug>
- One worker that changes files works in that result worktree.
- Parallel workers that change files each get a worktree from the result branch:
    git -C <repo> worktree add ~/.herdr/worktrees/<repo name>/<worker name> -b orch/<goal slug>-<worker name> orch/<goal slug>
- Workers that only read use <repo> directly.

How to work:
1. Split the goal into tasks. If you don't know enough, first start one worker to investigate and report.
2. Show the user the plan before any worker that changes files starts, and wait for their OK.
3. Start the workers. Right after you start one, check it once with hc read <name>; if it asks to trust the folder, answer it (hc keys <name> enter).
4. Wait with hc wait --children any. Never sleep or poll. Reports arrive as <hc from=...> messages. Wait until every worker has reported.
5. If parallel workers used their own worktrees, start one worker in the result worktree to merge their branches into orch/<goal slug>.
6. Start the single reviewer in the result worktree and wait for its review.
7. Judge the review yourself. Send each fix to the worker that did that part, then have the reviewer recheck only those fixes. At most 2 fix rounds.
8. Ask the user only about deploying, publishing, merging into their branch, spending money, deleting data, or product direction.
9. Close each helper once it is no longer needed: hc kill <name>.
10. Answer the user: what was done, what the review found, what you fixed, what is still open, and the branch orch/<goal slug> to merge.
11. When the goal is finished, close every helper (check with hc ls) and remove the worker worktrees. Keep the result branch.
Run hc --skill once if you need the full hc manual.

Now ask the user for the goal, unless they already gave it.`;
}

export default class OrchestraLite extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.button = Boolean(props()?.button);
    if (this.button) return;
    try { this.catalog = JSON.parse(localStorage.getItem("catalog") ?? "null"); } catch { this.catalog = null; }
    if (checking()) return;
    this.load(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        if (c === "start") this.start();
        if (c === "reload") this.load(cx);
        cx.notify();
      }
    });
  }

  picks() {
    return { ...DEFAULTS, ...(shared("orchestra-lite.picks") ?? {}) };
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/orchestra-lite/agents.py`], { timeout: 90000 });
        this.catalog = JSON.parse(r.stdout);
        localStorage.setItem("catalog", JSON.stringify(this.catalog));
        this.status = null;
      } catch (e) {
        this.status = `Could not find the agents: ${e}`;
      }
      this.loading = false;
      this.writeTemplates(cx);
    });
  }

  setPick(role, change, cx) {
    const picks = this.picks();
    let pick = { ...picks[role], ...change };
    const best = (m) => (m?.efforts?.includes("high") ? "high" : m?.efforts?.at(-1) ?? null);
    if (change.agent) {
      const first = this.models(change.agent)[0];
      pick = { agent: change.agent, model: first?.id ?? "", effort: best(first) };
    } else if (change.model) {
      const m = this.models(pick.agent).find((x) => x.id === change.model);
      if (!m?.efforts?.includes(pick.effort)) pick.effort = best(m);
    }
    setShared("orchestra-lite.picks", { ...picks, [role]: pick });
    this.writeTemplates(cx);
  }

  models(agent) {
    return this.catalog?.[agent]?.models ?? [];
  }

  writeTemplates(cx) {
    if (!this.catalog) return;
    cx.spawn(async (cx) => {
      const picks = this.picks();
      const dir = `${home()}/.config/herdr-core/templates`;
      try {
        await exec("mkdir", ["-p", dir]);
        for (const role of ["worker", "reviewer"]) {
          const name = template(role);
          const path = `${dir}/${name}.md`;
          const command = argv(picks[role], role, this.catalog).map((a) => (/^[\w.\-=/]+$/.test(a) ? a : `'${a}'`)).join(" ");
          const text = `---\nname: ${name}\ndescription: Orchestra Lite ${role} (${describe(picks[role])})\ncommand: ${command}\n---\n${TEMPLATE_BODY[role]}\n`;
          const old = await readTextFile(path);
          if (old !== text) await writeTextFile(path, text, old);
        }
      } catch (e) {
        this.status = `Could not save the helper roles: ${e}`;
      }
      cx.notify();
    });
  }

  // What stops a start: a role's agent is missing, or it has no model picked.
  problem(picks) {
    if (!this.catalog) return this.loading ? "Finding the agents..." : "Agents not found yet. Press Reload.";
    for (const r of ROLES) {
      const p = picks[r.id];
      const label = AGENTS.find((a) => a.id === p.agent)?.label;
      if (!this.catalog[p.agent]?.bin) return `${label} was not found on this machine (${r.label}).`;
      if (!p.model) return `${r.label}: pick a model.`;
    }
    return null;
  }

  start() {
    const picks = this.picks();
    if (this.problem(picks)) return;
    const lead = picks.orchestrator;
    // Claude reads words after --allowedTools as more tools: the brief goes after --.
    const first = lead.agent === "claude" ? ["--", brief(picks)] : [brief(picks)];
    run("tab.new", { name: "Orchestrator", argv: [...argv(lead, "orchestrator", this.catalog), ...first] });
  }

  chips(t, id, options, selected, fn) {
    return h_flex().flex_wrap().gap(4).children(options.map((o) => {
      const on = o.id === selected;
      return h_flex().id(`${id}-${o.id}`).cursor_pointer().px(8).h(24).items_center().rounded(5).text_size(11.5)
        .border(1).border_color(on ? t.input : t.border).bg(on ? t.selected : t.background)
        .text_color(on ? t.foreground : o.absent ? t.dim : t.muted)
        .when(on, (el) => el.font_medium())
        .hover((s) => s.bg(t.hover))
        .when(Boolean(o.tip), (el) => el.tooltip(o.tip))
        .on_click((_e, cx) => { cx.stop_propagation(); fn(o.id, cx); cx.notify(); })
        .child(o.label);
    }));
  }

  role(t, role, pick) {
    const label = (s) => div().text_size(11).text_color(t.muted).child(s);
    const models = this.models(pick.agent);
    const efforts = models.find((m) => m.id === pick.model)?.efforts ?? [];
    const agentChoices = AGENTS.map((a) => {
      const absent = Boolean(this.catalog) && !this.catalog[a.id]?.bin;
      return { ...a, absent, tip: absent ? `${a.label} was not found on this machine` : null };
    });
    const empty = pick.agent === "pi" ? "No Pi models. Add one to ~/.pi/agent/models.json or log in with pi, then Reload." : "No models found";
    return v_flex().flex_none().gap(6).p(10).rounded(8).bg(t.surface).border(1).border_color(t.border)
      .child(h_flex().gap(6).items_center()
        .child(div().text_size(12.5).font_semibold().child(role.label))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(role.about)))
      .child(label("Agent"))
      .child(this.chips(t, `${role.id}-agent`, agentChoices, pick.agent, (v, cx) => this.setPick(role.id, { agent: v }, cx)))
      .child(label("Model"))
      .child(models.length ? this.chips(t, `${role.id}-model`, models, pick.model, (v, cx) => this.setPick(role.id, { model: v }, cx))
        : div().text_size(11.5).text_color(t.muted).child(this.loading ? "Reading the models..." : empty))
      .children(efforts.length ? [label("Effort"),
        this.chips(t, `${role.id}-effort`, efforts.map((e) => ({ id: e, label: e })), pick.effort, (v, cx) => this.setPick(role.id, { effort: v }, cx))] : []);
  }

  bar(t) {
    const find = (n) => (n?.id === "orch" ? n : (n?.children ?? []).map(find).find(Boolean) ?? null);
    const node = find(layout());
    const open = Boolean(node) && !node.hidden;
    return h_flex().id("orch-bar").size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("orch-toggle").h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
        .bg(open ? t.selected : t.chrome).text_color(open ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => run("layout.toggle", { id: "orch" }))
        .tooltip(open ? "Hide Orchestra Lite" : "Show Orchestra Lite")
        .child(svg("mods/orchestra-lite/orchestra.svg").size(14)).child("Orchestra Lite"));
  }

  render() {
    const t = theme();
    if (this.button) return this.bar(t);
    const picks = this.picks();
    const problem = this.problem(picks);
    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/orchestra-lite/orchestra.svg").size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child("Orchestra Lite"))
      .child(div().id("reload").cursor_pointer().flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(11.5)
        .border(1).border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Find Claude Code and Pi again and read their models")
        .on_click((_e, cx) => { cx.stop_propagation(); this.load(cx); })
        .child(this.loading ? "Reading..." : "Reload"));
    const startButton = div().id("start").w_full().py(6).rounded(6).flex().justify_center().text_size(12.5).font_medium()
      .bg(t.solid).text_color(t.solid_foreground)
      .when(!problem, (el) => el.cursor_pointer().hover((s) => s.opacity(0.9)).on_click((_e, cx) => { cx.stop_propagation(); this.start(); }))
      .when(Boolean(problem), (el) => el.opacity(0.5))
      .child("Start orchestrator");
    const pinned = v_flex().flex_none().px(12).pt(12).pb(10).gap(6).border_b(1).border_color(t.border)
      .child(startButton)
      .child(div().truncate().text_size(11).text_color(problem ? t.blocked : t.muted)
        .child(problem ?? `Opens a new tab with ${describe(picks.orchestrator)}`));
    const status = this.status ? div().flex_none().px(14).pt(8).text_size(11.5).text_color(t.blocked).child(this.status) : null;
    const body = v_flex().id("orchestra-lite-roles").flex_1().min_h(0).px(12).py(10).gap(8).overflow_y_scrollbar()
      .children(ROLES.map((r) => this.role(t, r, picks[r.id])));
    return v_flex().id("orchestra-lite").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
      .border_1().border_color(this.handle.is_focused() ? t.accent : t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { run("pane.go", { direction: "left" }); cx.stop_propagation(); } })
      .children([header, status, pinned, body].filter(Boolean));
  }
}
