# TC3 Tool Optimizer — CABIN Edition

A material/tool optimizer for **Tinkers' Construct 3** tuned for the
**[CABIN: Create Above & Beyond In Newer](https://www.curseforge.com/minecraft/modpacks/cabin)**
modpack (CABIN 2.1.3, Minecraft 1.20.1, TConstruct 3.11.2.166).

Pick a tool, pick materials per part, and it computes durability, attack,
DPS, mining speed/tier, armor stats and traits — or let the optimizer
search the best material combination for a goal (DPS, durability, mining…).

## Why this exists

Generic TC3 calculators pull data from the Tinkers' Construct GitHub
`1.20.1` branch, which tracks the *latest* release. CABIN pins an older
TConstruct build, so those tools show wrong stats (rebalanced bows, the
reworked slimesuit, phantom materials). This one is different:

- **All game data is bundled statically** (`tc3_data.js`), generated from
  the exact TConstruct 3.11.2.166 datapack that CABIN 2.1.3 ships.
  No network fetches, no drift, works offline.
- **Material availability matches the pack**: metals provided by CABIN's
  mod list (Thermal Series constantan/electrum/invar, bronze/lead/silver,
  and CABIN's custom pewter alloy) are shown by default; materials with no
  source in the pack (Twilight Forest, Mekanism, Immersive Engineering…)
  are hidden. The ⚙ Mods panel can still toggle groups for what-if
  scenarios.

## Run it

It's a fully static site — no build step.

```bash
# any static server works:
npx serve .
# or
python -m http.server
```

Opening `index.html` directly from disk also works (the data bundle is a
script tag, not a fetch). To host it, drop the folder on any static host
(GitHub Pages, Netlify, …) — no server-side code required.

## Tests

```bash
node --test tc3_optimizer.test.js   # 113 unit tests, no dependencies
```

## Rebuilding the data bundle

If CABIN updates its TConstruct version:

```bash
python build_tc3_data.py <path-to-tconstruct-source-tree> tc3_data.js
```

The source tree must contain `src/generated/resources/data/tconstruct/…`
and `src/main/resources/assets/tconstruct/lang/en_us.json` (i.e. a
checkout of SlimeKnights/TinkersConstruct at the matching tag, or an
extracted equivalent). Review the `CABIN_AVAILABLE` / `CABIN_UNAVAILABLE`
lists in the script if the pack's mod list changed.

## Credits & license

- Game data © SlimeKnights — [Tinkers' Construct](https://github.com/SlimeKnights/TinkersConstruct),
  used under the MIT license.
- [CABIN](https://github.com/ThePansmith/CABIN) modpack by Pansmith.
- Tooling code in this repo is MIT.
