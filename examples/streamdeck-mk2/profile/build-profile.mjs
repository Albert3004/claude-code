#!/usr/bin/env node
/*
 * Builds "Claude-Helper.streamDeckProfile" for the Stream Deck MK2.
 *
 * The profile is a ZIP whose root is a "<UUID>.sdProfile" folder containing a
 * manifest.json. Keys are addressed by "column,row" (MK2 = 5 columns x 3 rows).
 * Each key references an action UUID from the Claude Code Controls plugin plus
 * its per-key settings, so importing the profile lays out and pre-configures
 * every button. The plugin still (re)draws each face at runtime.
 *
 * Run:  node build-profile.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..", "com.anthropic.claudecode.controls.sdPlugin");
const imgsDir = path.join(pluginDir, "imgs", "actions");
const outDir = here;

const PROFILE_UUID = "C1A0DE00-0000-4000-8000-C0DEC0DE0001"; // stable folder id
const A = "com.anthropic.claudecode.controls";

function dataUri(svgFile) {
  const svg = fs.readFileSync(path.join(imgsDir, svgFile), "utf8");
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function state(image) {
  return { Image: image, Title: "", TitleColor: "#f7f5ee", FSize: "12", FFamily: "", TitleAlignment: "bottom" };
}

function key(name, uuid, image, settings) {
  return {
    Name: name,
    UUID: `${A}.${uuid}`,
    Controller: "Keypad",
    State: 0,
    Settings: settings || {},
    States: [state(image)],
  };
}

// Layout: column,row  (MK2 is 5 wide, 3 tall)
const actions = {
  "0,0": key("Claude Aktiv", "status", dataUri("status.svg"), { activeWindowSec: "120" }),
  "1,0": key("Wochen-Nutzung", "usage", dataUri("usage.svg"), { weeklyBudget: "400000000" }),
  "3,0": key("Neuer Coding-Task", "newtask", dataUri("newtask.svg"), { command: "claude" }),
  "4,0": key("Neuer Chat", "newchat", dataUri("newchat.svg"), { url: "https://claude.ai/new" }),

  "0,1": key("Opus 4.8", "model", dataUri("model.svg"), { modelId: "claude-opus-4-8", label: "Opus 4.8" }),
  "1,1": key("Sonnet 5", "model", dataUri("model.svg"), { modelId: "claude-sonnet-5", label: "Sonnet 5" }),
  "2,1": key("Haiku 4.5", "model", dataUri("model.svg"), { modelId: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }),
  "3,1": key("Fable 5", "model", dataUri("model.svg"), { modelId: "claude-fable-5", label: "Fable 5" }),
};

const manifest = {
  Name: "Claude-Helper",
  Version: "1.0",
  DeviceModel: "20GAA9902", // Stream Deck MK.2
  DeviceUUID: "@(8)[ffffffff-ffff-ffff-ffff-ffffffffffff]", // any matching device
  Actions: actions,
};

// Assemble the bundle in a temp dir, then zip it.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "sdprofile-"));
const bundleDir = path.join(work, `${PROFILE_UUID}.sdProfile`);
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const outFile = path.join(outDir, "Claude-Helper.streamDeckProfile");
fs.rmSync(outFile, { force: true });
execFileSync("zip", ["-r", "-X", "-q", outFile, `${PROFILE_UUID}.sdProfile`], { cwd: work });
fs.rmSync(work, { recursive: true, force: true });

console.log("Wrote", path.relative(process.cwd(), outFile));
