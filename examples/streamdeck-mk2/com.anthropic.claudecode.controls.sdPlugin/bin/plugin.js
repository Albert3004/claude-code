#!/usr/bin/env node
"use strict";

/*
 * Claude Code Controls - Stream Deck MK2 plugin
 *
 * Zero-dependency implementation of the Elgato Stream Deck plugin protocol.
 * It speaks the WebSocket registration protocol directly over a TCP socket so
 * it runs on the Node.js runtime bundled with the Stream Deck app (v20+) with
 * no `npm install` and no bundler step.
 *
 * Actions:
 *   .status   -> shows whether a Claude Code session is currently active
 *   .usage    -> shows this week's usage as a percentage of a budget
 *   .model    -> sets the default Claude model (Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5)
 *   .newtask  -> opens a terminal and starts `claude` in a project directory
 *   .newchat  -> starts a new chat (opens claude.ai/new by default)
 */

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec, execFile } = require("child_process");

// ---------------------------------------------------------------------------
// Command-line arguments passed by the Stream Deck host.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = String(argv[i] || "").replace(/^-+/, "");
    out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port);
const PLUGIN_UUID = args.pluginUUID;
const REGISTER_EVENT = args.registerEvent;

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const SCRIPT_DIR = path.resolve(__dirname, "..", "scripts");

const MODEL_PRESETS = {
  "claude-opus-4-8": "Opus 4.8",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-fable-5": "Fable 5",
};

// ---------------------------------------------------------------------------
// Minimal RFC-6455 WebSocket client (localhost, text frames).
// ---------------------------------------------------------------------------
class MiniWebSocket {
  constructor(port) {
    this.port = port;
    this.buf = Buffer.alloc(0);
    this.connected = false;
    this.onopen = () => {};
    this.onmessage = () => {};
    this.frag = null;
    this.sock = net.connect(port, "127.0.0.1", () => this._handshake());
    this.sock.on("data", (chunk) => this._onData(chunk));
    this.sock.on("error", () => {});
    this.sock.on("close", () => process.exit(0));
  }

  _handshake() {
    this.key = crypto.randomBytes(16).toString("base64");
    this.sock.write(
      "GET / HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${this.port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${this.key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n"
    );
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (!this.connected) {
      const idx = this.buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      this.buf = this.buf.slice(idx + 4);
      this.connected = true;
      this.onopen();
    }
    this._parse();
  }

  _parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < offset + 4) return;
        maskKey = this.buf.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buf.length < offset + len) return;
      let payload = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);
      if (masked) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4];
        payload = out;
      }

      if (opcode === 0x8) {
        this.sock.end();
        return;
      }
      if (opcode === 0x9) {
        this._send(0xa, payload); // pong
        continue;
      }
      if (opcode === 0xa) continue; // pong

      if (opcode === 0x0) {
        this.frag = this.frag ? Buffer.concat([this.frag, payload]) : payload;
      } else {
        this.frag = payload;
      }
      if (fin && this.frag) {
        const msg = this.frag.toString("utf8");
        this.frag = null;
        try {
          this.onmessage(JSON.parse(msg));
        } catch (_) {
          /* ignore malformed frames */
        }
      }
    }
  }

  _send(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const mask = crypto.randomBytes(4);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, out]));
  }

  sendJson(obj) {
    this._send(0x1, Buffer.from(JSON.stringify(obj), "utf8"));
  }
}

// ---------------------------------------------------------------------------
// SVG rendering for button faces.
// ---------------------------------------------------------------------------
const C = {
  bg: "#26231d",
  bg2: "#1b1915",
  clay: "#d97757",
  text: "#ece7dd",
  muted: "#8a8578",
  green: "#4ade80",
  yellow: "#fbbf24",
  red: "#f87171",
  grey: "#5b564d",
};

function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function toImage(svg) {
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// Claude "sunburst" asterisk mark centred in a 144x144 canvas.
function mark(cx, cy, r, color) {
  const bar = (rot) =>
    `<rect x="${cx - r * 0.11}" y="${cy - r}" width="${r * 0.22}" height="${r * 2}" rx="${r * 0.11}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  return `<g fill="${color}">${bar(0)}${bar(45)}${bar(90)}${bar(135)}</g>`;
}

function frame(inner, border) {
  const stroke = border ? `<rect x="4" y="4" width="136" height="136" rx="22" fill="none" stroke="${C.clay}" stroke-width="4"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
    `<rect width="144" height="144" rx="24" fill="${C.bg}"/>` +
    inner +
    stroke +
    `</svg>`
  );
}

function faceStatus(active) {
  const color = active ? C.green : C.grey;
  const label = active ? "Aktiv" : "Inaktiv";
  return toImage(
    frame(
      `<text x="72" y="26" fill="${C.muted}" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2" text-anchor="middle">CLAUDE</text>` +
        `<circle cx="72" cy="72" r="30" fill="${color}" opacity="0.18"/>` +
        `<circle cx="72" cy="72" r="20" fill="${color}"/>` +
        mark(72, 72, 12, C.bg2) +
        `<text x="72" y="128" fill="${C.text}" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="700" text-anchor="middle">${esc(label)}</text>`
    )
  );
}

function faceUsage(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const color = p >= 90 ? C.red : p >= 70 ? C.yellow : C.green;
  const r = 46;
  const circ = 2 * Math.PI * r;
  const dash = (circ * p) / 100;
  return toImage(
    frame(
      `<text x="72" y="24" fill="${C.muted}" font-family="Helvetica,Arial,sans-serif" font-size="14" font-weight="700" letter-spacing="2" text-anchor="middle">WOCHE</text>` +
        `<g transform="rotate(-90 72 78)">` +
        `<circle cx="72" cy="78" r="${r}" fill="none" stroke="${C.bg2}" stroke-width="10"/>` +
        `<circle cx="72" cy="78" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash} ${circ}"/>` +
        `</g>` +
        `<text x="72" y="86" fill="${C.text}" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="800" text-anchor="middle">${p}%</text>`
    )
  );
}

function faceModel(label, isCurrent) {
  const parts = String(label || "Modell").split(" ");
  const line1 = esc(parts.slice(0, -1).join(" ") || parts[0]);
  const line2 = esc(parts.length > 1 ? parts[parts.length - 1] : "");
  const badge = isCurrent
    ? `<circle cx="112" cy="34" r="13" fill="${C.clay}"/>` +
      `<path d="M106 34 l4 4 l8 -9" fill="none" stroke="${C.bg2}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  return toImage(
    frame(
      mark(40, 34, 15, isCurrent ? C.clay : C.muted) +
        badge +
        `<text x="72" y="88" fill="${C.text}" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="800" text-anchor="middle">${line1}</text>` +
        `<text x="72" y="120" fill="${isCurrent ? C.clay : C.muted}" font-family="Helvetica,Arial,sans-serif" font-size="24" font-weight="800" text-anchor="middle">${line2}</text>`,
      isCurrent
    )
  );
}

function faceAction(glyph, l1, l2) {
  return toImage(
    frame(
      `<g transform="translate(72 52)">${glyph}</g>` +
        `<text x="72" y="106" fill="${C.text}" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="800" text-anchor="middle">${esc(l1)}</text>` +
        `<text x="72" y="128" fill="${C.muted}" font-family="Helvetica,Arial,sans-serif" font-size="16" font-weight="600" text-anchor="middle">${esc(l2)}</text>`
    )
  );
}

const GLYPH_TERMINAL =
  `<rect x="-30" y="-24" width="60" height="46" rx="8" fill="none" stroke="${C.clay}" stroke-width="4"/>` +
  `<path d="M-18 -8 l10 8 l-10 8" fill="none" stroke="${C.text}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<line x1="0" y1="10" x2="16" y2="10" stroke="${C.text}" stroke-width="4" stroke-linecap="round"/>`;

const GLYPH_CHAT =
  `<path d="M-30 -22 h60 a6 6 0 0 1 6 6 v28 a6 6 0 0 1 -6 6 h-34 l-16 14 v-14 h-10 a6 6 0 0 1 -6 -6 v-28 a6 6 0 0 1 6 -6 z" fill="none" stroke="${C.clay}" stroke-width="4" stroke-linejoin="round"/>` +
  mark(0, -2, 12, C.text);

// ---------------------------------------------------------------------------
// Data helpers.
// ---------------------------------------------------------------------------
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (_) {
    return {};
  }
}

function writeModel(modelId) {
  let settings = readSettings();
  settings.model = modelId;
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (_) {
    return false;
  }
}

function currentModel() {
  return readSettings().model || "";
}

// "Active" = a session transcript was touched within `windowSec` seconds.
function isClaudeActive(windowSec, cb) {
  let newest = 0;
  const cutoff = Date.now() - windowSec * 1000;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.name.endsWith(".jsonl")) {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch (_) {}
      }
    }
  };
  walk(PROJECTS_DIR);
  cb(newest >= cutoff);
}

// Run a shell command, resolve with trimmed stdout (or null on failure).
function runCapture(cmd, cb) {
  exec(cmd, { timeout: 15000, windowsHide: true }, (err, stdout) => {
    cb(err ? null : String(stdout).trim());
  });
}

function getUsagePercent(customCmd, budget, cb) {
  const cmd =
    customCmd && customCmd.trim()
      ? customCmd
      : `node "${path.join(SCRIPT_DIR, "weekly-usage.mjs")}" --budget ${Number(budget) || 0}`;
  runCapture(cmd, (out) => {
    if (out == null) return cb(null);
    const m = out.match(/-?\d+(\.\d+)?/);
    cb(m ? parseFloat(m[0]) : null);
  });
}

// Platform-aware default command templates. {dir}, {cmd} and {url} are substituted.
function defaultTaskCmd() {
  if (process.platform === "darwin") {
    return `osascript -e 'tell app "Terminal" to do script "cd \\"{dir}\\" && {cmd}"' -e 'tell app "Terminal" to activate'`;
  }
  if (process.platform === "win32") {
    return `start "" cmd /k "cd /d {dir} && {cmd}"`;
  }
  return `x-terminal-emulator -e bash -c "cd '{dir}' && {cmd}; exec bash" || gnome-terminal -- bash -c "cd '{dir}' && {cmd}; exec bash"`;
}

function defaultOpenUrlCmd() {
  if (process.platform === "darwin") return `open "{url}"`;
  if (process.platform === "win32") return `start "" "{url}"`;
  return `xdg-open "{url}"`;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ""));
}

// ---------------------------------------------------------------------------
// Plugin controller.
// ---------------------------------------------------------------------------
const ACTION = {
  STATUS: "com.anthropic.claudecode.controls.status",
  USAGE: "com.anthropic.claudecode.controls.usage",
  MODEL: "com.anthropic.claudecode.controls.model",
  NEWTASK: "com.anthropic.claudecode.controls.newtask",
  NEWCHAT: "com.anthropic.claudecode.controls.newchat",
};

const ws = new MiniWebSocket(PORT);
const contexts = new Map(); // context -> { action, settings }

function send(obj) {
  ws.sendJson(obj);
}
function setImage(context, image) {
  send({ event: "setImage", context, payload: { image, target: 0 } });
}
function showOk(context) {
  send({ event: "showOk", context });
}
function showAlert(context) {
  send({ event: "showAlert", context });
}
function log(message) {
  send({ event: "logMessage", payload: { message: String(message) } });
}

function refresh(context) {
  const entry = contexts.get(context);
  if (!entry) return;
  const s = entry.settings || {};
  switch (entry.action) {
    case ACTION.STATUS:
      isClaudeActive(Number(s.activeWindowSec) || 120, (active) => setImage(context, faceStatus(active)));
      break;
    case ACTION.USAGE:
      getUsagePercent(s.usageCommand, s.weeklyBudget, (pct) => {
        setImage(context, faceUsage(pct == null ? 0 : pct));
      });
      break;
    case ACTION.MODEL: {
      const id = s.modelId || "claude-opus-4-8";
      const label = s.label || MODEL_PRESETS[id] || id;
      setImage(context, faceModel(label, currentModel() === id));
      break;
    }
    case ACTION.NEWTASK:
      setImage(context, faceAction(GLYPH_TERMINAL, "Coding-Task", "starten"));
      break;
    case ACTION.NEWCHAT:
      setImage(context, faceAction(GLYPH_CHAT, "Neuer Chat", "starten"));
      break;
  }
}

function refreshAll() {
  for (const context of contexts.keys()) refresh(context);
}

function onKeyDown(context, entry) {
  const s = entry.settings || {};
  switch (entry.action) {
    case ACTION.MODEL: {
      const id = s.modelId || "claude-opus-4-8";
      if (s.command && s.command.trim()) {
        runCapture(fillTemplate(s.command, { model: id }), () => {});
        showOk(context);
      } else {
        writeModel(id) ? showOk(context) : showAlert(context);
      }
      setTimeout(refreshAll, 250); // update the highlighted model on every key
      break;
    }
    case ACTION.NEWTASK: {
      const dir = s.directory && s.directory.trim() ? s.directory : HOME;
      const inner = s.command && s.command.trim() ? s.command : "claude";
      const tpl = s.terminalTemplate && s.terminalTemplate.trim() ? s.terminalTemplate : defaultTaskCmd();
      exec(fillTemplate(tpl, { dir, cmd: inner }), { windowsHide: true }, (err) =>
        err ? showAlert(context) : showOk(context)
      );
      break;
    }
    case ACTION.NEWCHAT: {
      if (s.command && s.command.trim()) {
        exec(s.command, { windowsHide: true }, (err) => (err ? showAlert(context) : showOk(context)));
      } else {
        const url = s.url && s.url.trim() ? s.url : "https://claude.ai/new";
        exec(fillTemplate(defaultOpenUrlCmd(), { url }), { windowsHide: true }, (err) =>
          err ? showAlert(context) : showOk(context)
        );
      }
      break;
    }
    case ACTION.STATUS:
    case ACTION.USAGE:
      refresh(context); // manual refresh on press
      break;
  }
}

// ---------------------------------------------------------------------------
// Event wiring.
// ---------------------------------------------------------------------------
ws.onopen = () => {
  send({ event: REGISTER_EVENT, uuid: PLUGIN_UUID });
  setInterval(refreshAll, 10000); // periodic refresh of live faces
};

ws.onmessage = (msg) => {
  const { event, context, action, payload } = msg;
  switch (event) {
    case "willAppear":
      contexts.set(context, { action, settings: (payload && payload.settings) || {} });
      refresh(context);
      break;
    case "willDisappear":
      contexts.delete(context);
      break;
    case "didReceiveSettings": {
      const entry = contexts.get(context);
      if (entry) {
        entry.settings = (payload && payload.settings) || {};
        refresh(context);
      }
      break;
    }
    case "keyDown": {
      const entry = contexts.get(context) || { action, settings: (payload && payload.settings) || {} };
      onKeyDown(context, entry);
      break;
    }
    case "propertyInspectorDidAppear":
      refresh(context);
      break;
  }
};

process.on("uncaughtException", (e) => log("uncaught: " + (e && e.message)));
