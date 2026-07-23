#!/usr/bin/env node
/*
 * weekly-usage.mjs
 *
 * Prints a single number 0-100: this week's Claude Code token usage as a
 * percentage of a weekly budget.
 *
 * There is no stable local API that exposes the exact percentage of the
 * subscription's weekly rate limit, so this approximates it from the local
 * session transcripts under ~/.claude/projects measured against a
 * budget you choose. Tune the budget to your plan until the number matches
 * what `/usage` reports inside Claude Code.
 *
 * Usage:
 *   node weekly-usage.mjs --budget 400000000
 *   WEEKLY_TOKEN_BUDGET=400000000 node weekly-usage.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const budget =
  Number(argValue("--budget")) || Number(process.env.WEEKLY_TOKEN_BUDGET) || 400_000_000;

const projectsDir = path.join(os.homedir(), ".claude", "projects");

// Start of the current week (Monday 00:00 local time).
function startOfWeek() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.getTime();
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".jsonl")) yield full;
  }
}

const weekStart = startOfWeek();
let tokens = 0;

for (const file of walk(projectsDir)) {
  // Skip files not modified this week to avoid parsing old transcripts.
  try {
    if (fs.statSync(file).mtimeMs < weekStart) continue;
  } catch {
    continue;
  }
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of content.split("\n")) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
    if (Number.isFinite(ts) && ts < weekStart) continue;
    const u = obj?.message?.usage;
    if (!u) continue;
    tokens +=
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
  }
}

const pct = budget > 0 ? Math.min(100, (tokens / budget) * 100) : 0;
process.stdout.write(String(Math.round(pct)));
