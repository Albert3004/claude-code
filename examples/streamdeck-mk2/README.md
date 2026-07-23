# Claude Code Controls – Stream Deck MK2

Eine Tastenbelegung (Stream-Deck-Plugin) für das **Elgato Stream Deck MK2**
(15 Tasten, 5×3). Sie zeigt live an, ob Claude gerade aktiv ist und wie hoch
die Nutzung dieser Woche in Prozent ist, lässt dich zwischen allen Modellen
(inkl. **Fable 5**) wechseln und startet mit einem Tastendruck einen neuen
Coding-Task oder einen neuen Chat.

Das Plugin ist **ohne Abhängigkeiten** in reinem Node.js geschrieben und spricht
das Stream-Deck-Protokoll direkt. Es gibt **kein `npm install` und keinen
Build-Schritt** – der Plugin-Ordner ist sofort einsatzbereit.

## Tastenbelegung

```
┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
│  Claude       │  Wochen-      │               │  Neuer        │  Neuer        │
│  Aktiv ●      │  Nutzung 42%  │               │  Coding-Task  │  Chat 💬      │
├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│  Opus 4.8     │  Sonnet 5     │  Haiku 4.5    │  Fable 5      │               │
│               │               │               │               │               │
├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
│               │               │               │               │               │
│               │               │               │               │               │
└───────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
```

Die Anordnung ist ein Vorschlag – du kannst jede Taste im Stream-Deck-Editor
frei ziehen. Das aktuell gewählte Modell wird mit einem orangefarbenen Rahmen
und Häkchen hervorgehoben.

## Aktionen

| Aktion | Was sie tut |
|--------|-------------|
| **Claude Aktiv** | Grün, wenn innerhalb des Zeitfensters (Standard 120 s) ein Session-Transkript in `~/.claude/projects` geschrieben wurde, sonst grau. |
| **Wochen-Nutzung** | Ring + Prozentwert des Wochenverbrauchs gegen ein einstellbares Budget. Grün < 70 %, gelb < 90 %, rot darüber. |
| **Modell wählen** | Setzt beim Druck das Standardmodell in `~/.claude/settings.json`. Je Taste ein Modell: Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5. |
| **Neuer Coding-Task** | Öffnet ein Terminal und startet `claude` im gewählten Projektordner. |
| **Neuer Chat** | Öffnet `https://claude.ai/new` im Browser (oder einen eigenen Befehl). |

## Installation

1. Stelle sicher, dass die **Stream-Deck-Software 6.5+** installiert ist (SVG-
   und Node.js-Plugin-Unterstützung).
2. Kopiere den Ordner `com.anthropic.claudecode.controls.sdPlugin` nach:
   - **macOS:** `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
   - **Windows:** `%APPDATA%\Elgato\StreamDeck\Plugins\`
3. Starte die Stream-Deck-Software neu.
4. Ziehe die Aktionen aus der Kategorie **„Claude Code"** auf die Tasten – wie
   oben gezeigt.

> Alternativ per Doppelklick installieren: den Ordner mit einem Zip-Tool zu
> einer Datei `Claude Code Controls.streamDeckPlugin` packen (der Ordnername
> `…​.sdPlugin` muss die Wurzel im Archiv sein) und öffnen.

## Konfiguration

Jede Taste hat einen Property Inspector (rechts im Editor):

- **Wochen-Nutzung** – *Wochen-Budget (Tokens)*. Die Prozentanzeige ist
  `Verbrauch ÷ Budget`. Stelle das Budget so ein, dass der Wert zu dem passt,
  was `/usage` in Claude Code zeigt. Optional ein *eigener Befehl*, der eine
  Zahl 0–100 ausgibt (z. B. auf Basis von [`ccusage`](https://github.com/ryoppippi/ccusage)).
- **Modell wählen** – Modell aus der Liste, optionale Beschriftung und optional
  ein *eigener Befehl* (`{model}` wird durch die Modell-ID ersetzt), falls du
  z. B. lieber `claude config set -g model {model}` ausführen willst.
- **Neuer Coding-Task** – *Projektordner*, *Befehl* (Standard `claude`) und eine
  optionale plattformspezifische *Terminal-Vorlage* (`{dir}`, `{cmd}`).
- **Neuer Chat** – *Chat-URL* (Standard `https://claude.ai/new`) oder ein
  *eigener Befehl*.
- **Claude Aktiv** – Länge des *Aktiv-Fensters* in Sekunden.

### Hinweis zur Wochen-Nutzung

Es gibt keine stabile lokale Schnittstelle, die den exakten Prozentsatz des
wöchentlichen Abo-Limits liefert. Das mitgelieferte Skript
`scripts/weekly-usage.mjs` **nähert** den Wert an, indem es die Token aus den
lokalen Transkripten der laufenden Woche gegen ein von dir gewähltes Budget
rechnet. Für einen exakteren Wert hinterlege einen eigenen Befehl im Property
Inspector.

## Aufbau

```
com.anthropic.claudecode.controls.sdPlugin/
├── manifest.json          # Aktionsdefinitionen
├── bin/plugin.js          # Plugin-Logik (Zero-Dependency-WebSocket-Protokoll)
├── scripts/weekly-usage.mjs  # Standard-Berechnung der Wochennutzung
├── ui/                    # Property-Inspector-Seiten (HTML/JS/CSS)
└── imgs/                  # SVG-Icons
```

## Kompatibilität

- Stream Deck **MK2** (funktioniert auch auf anderen Keypad-Modellen).
- Stream-Deck-Software **6.5+** (nutzt die gebündelte Node-20-Runtime; das
  Plugin läuft ebenso auf neueren Runtimes).
- macOS 12+ und Windows 10+. Für Linux (inoffizielle Stream-Deck-Software) sind
  Terminal-/Öffnen-Standards enthalten und lassen sich überschreiben.

> Beispielprojekt – kein offizielles Anthropic-Produkt. Passe die Befehle an
> deine Umgebung an.
