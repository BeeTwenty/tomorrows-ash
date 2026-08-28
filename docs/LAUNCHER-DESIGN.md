# The launcher's visual identity — "Instrument"

**Status:** proposal, awaiting sign-off. Companion to
[ADR 0006](decisions/0006-launcher-architecture.md).

The brief asked for something original and deliberately *not* the website. This
document says what it is, why, and gives the tokens to build it with.

---

## 1. Why it must not look like the site

The website is an elegy. Near-black ground, one ember accent, a light serif,
film grain, ash drifting past, text that arrives warm and cools to bone. It is
read once, slowly, by someone deciding whether to care. Its job is mood, and it
is good at it.

The launcher is equipment. It is opened for eight seconds, repeatedly, usually
by someone impatient to be somewhere else. Nothing about the site's virtues
survives that context: slow reveals become lag, atmosphere becomes noise, and a
serif at 300 weight becomes a font you squint at while a progress bar moves.

So the launcher inherits the project's *character* — honesty, density,
no decoration that is not load-bearing — and inverts every one of its
*executions*.

| | Website | Launcher |
|---|---|---|
| Ground | warm near-black `#08080a` | **cold graphite** `#14161a`, and a real light theme |
| Type | Cormorant Garamond, 300 | **IBM Plex Sans Condensed / Plex Mono**, 500 |
| Colour | one ember accent, for beauty | **colour only ever means something** |
| Motion | 1.4s reveals, drifting ash | ≤120ms, only to show causality |
| Corner radius | 2px | **0** |
| Density | vast margins, one idea per screen | tabular, 4px grid, every pixel earns |
| Imagery | grain, vignette, ashfall | **none** |

## 2. The idea

**A maintenance panel, not a marquee.**

Every game launcher ever built is the same object: key art, a news feed, and an
enormous PLAY button. Ours is an instrument that reports the state of your
installation and refuses to lie about it. The emotional beat is not artwork. It
is a green light.

This falls directly out of what the launcher is *for*. Under ADR 0005 we cannot
fix a broken client — we have no right to the bytes. What we can do is diagnose
it exactly. A launcher whose core competence is honest diagnosis should look
like a thing that measures.

## 3. The three rules

**1. Colour is information, never decoration.** The palette is high-contrast
monochrome. Colour appears only when it carries meaning, and every hue has
exactly one:

- green — verified, ready
- amber — needs attention, will still run
- red — blocked, will not run
- blue — working right now
- **ember `#ff6a1f` — the realm is alive.** One pixel of shared DNA with the
  site, and it means there exactly what it means here.

The review question for any colour in this UI is "what does it tell me?" If
there is no answer, it comes out. This is the precise inverse of the site, where
the ember is there because it is beautiful.

**2. No game art. None.** No dragons, no key art, no logo splash, no borrowed
fonts. This is a design choice first — a tool that opens with a painting is
lying about what it is — and it happens to make ADR 0005 rule 5 unbreakable by
construction. We cannot accidentally infringe artwork we do not use. The only
mark is a small "ASHMORROW" wordmark in the condensed face.

**3. The button's label is the state.** Never a PLAY button that is a lie. It
reads `SELECT CLIENT` → `VERIFY` → `INSTALL PATCH` → `LAUNCH`, and when it is
disabled it says why, in the button, not in a tooltip.

## 4. Signature elements

**The readout strip.** A single dense row across the top, always visible:
realm · build · patch level · Wine version · latency. Monospaced, tabular,
unchanging in position so the eye learns where each number lives. This is the
launcher's equivalent of the site's ember rule — the one gesture it repeats.

**The file ledger.** A scrollable monospaced table of every file the manifest
knows about and its verification state, one row per file, always reachable in
one click. Every other launcher hides this behind "advanced". Ours makes it the
second screen, because it is the thing we are actually offering: the truth about
your install, in full, with nothing rounded off.

**The diagnosis panel.** When verification fails, the result is not a modal
saying "error". It is a written finding: what file, what was expected, what was
found, what that usually means, and what you can do. Our most common message
will be "this is not build 12340, and I cannot fix that for you". That sentence
has to be the best-designed thing in the application.

## 5. Tokens

```css
/* Cold graphite. Blue-shifted where the site is warm-shifted. */
--l-ground:      #14161a;   --l-ground-light:  #f4f5f7;
--l-panel:       #1b1e24;   --l-panel-light:   #ffffff;
--l-panel-high:  #22262e;   --l-rule-light:    #d6dae0;
--l-rule:        #2b3038;
--l-rule-strong: #3a414c;

--l-text:        #e6e9ee;   --l-text-light:    #16191e;
--l-text-dim:    #98a1ae;   --l-dim-light:     #5b6572;
--l-text-faint:  #5f6875;

/* Semantic only. Never used for emphasis, tone, or brand. */
--l-ok:      #4ec98a;
--l-warn:    #e0a83c;
--l-block:   #e05f52;
--l-busy:    #5aa9e6;
--l-realm:   #ff6a1f;   /* the realm is up. the one warm thing here. */

--l-font-ui:   "IBM Plex Sans Condensed", "Segoe UI", system-ui, sans-serif;
--l-font-num:  "IBM Plex Mono", ui-monospace, Consolas, monospace;

--l-radius: 0;
--l-grid:   4px;
--l-motion: 120ms linear;
```

Nothing here overlaps the site: not one colour, not one family, not the radius,
not the timing curve. `--l-realm` is the single deliberate exception, and it is
the same hex for the same reason.

**Why IBM Plex.** Open licensed, drawn for technical documentation, and shares
nothing with Cormorant, Inter or JetBrains Mono. The condensed cut buys
horizontal room the ledger needs, and Plex Mono's figures are unmistakable at
11px — which matters when the difference between two hashes is the whole point.

**Why a light theme, when the site refuses one.** Because the site's single
palette is a conviction and a tool's theme is a courtesy. Instruments follow the
room they are used in. It is also, bluntly, another axis of separation.

## 6. Layout

```
┌────────────────────────────────────────────────────────────┐
│ ASHMORROW    ● live   3.3.5a·12340   patch 0   wine 9.0  42ms │  readout strip
├────────────────────────────────────────────────────────────┤
│                                                            │
│  CLIENT      /home/s/games/wow-335a                        │
│              ████████████████████░░░░  18,204 / 22,110     │  verification
│              verified · 3 files differ from known-good     │
│                                                            │
│  REALMLIST   set realmlist ashmorrow.example        ✓      │
│  PATCH       none required                          ✓      │
│  ACCOUNT     sindre · 2 characters                  ✓      │
│                                                            │
│  ──────────────────────────────────────────────────────    │
│  3 files differ from the build we measured. They are not   │
│  files the realm reads. Details ▸                          │
│                                                            │
├────────────────────────────────────────────────────────────┤
│                         L A U N C H                        │  state-labelled
└────────────────────────────────────────────────────────────┘
```

One window, 900×600, resizable, no chrome we did not draw. Everything above the
launch bar is status; the launch bar is the only control that changes the world.

## 7. Motion

Transitions exist only where something changed and you need to see *what*.
Progress bars move because progress moved. State chips cross-fade in 120ms
because an instant swap reads as a glitch. Nothing eases, nothing bounces,
nothing arrives from off-screen, nothing is animated on load.

`prefers-reduced-motion` costs us almost nothing to honour, because there is
almost nothing to reduce.
