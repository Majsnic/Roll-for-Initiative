# Roll for Initiative

An initiative tracker for [Obsidian](https://obsidian.md) that keeps the whole fight as **plain text in your note**. You can run it in the note or from the sidebar.

- It reads HP, AC and initiative from your monster statblocks.
- It writes damage, healing, conditions and death saves straight back to your players' character sheets.
- It supports two game systems: **D&D 5e (2024)** and **Cyberpunk RED**.

> Roll for Initiative is built on [**Quick Initiative**](https://github.com/walkertbrown/quick-initiative) by **walkertbrown** (Bananafest Destiny). It follows Quick Initiative's plain-text block format and its look. See [Credits](#credits).

![The tracker in the middle of a fight](docs/screenshots/tracker.png)

---

## Features

- **The fight is plain text** in a ` ```roll-initiative ``` ` code block. It is readable, it syncs with your vault and it works on mobile. Edit it by hand or with the buttons.
- **Sidebar view**: run the same encounter from the right sidebar. Both views edit the same block.
- **Monster stats from statblocks**:
  - AC, HP, hit dice, initiative modifier, CR and portrait come from the note's ` ```statblock ``` ` (Fantasy Statblocks).
  - If a note has none, the plugin uses its frontmatter instead, then the Fantasy Statblocks bestiary.
  - **Statblock numbers always win.**
- **Live character sheets** (One DnD Character Sheet):
  - HP, temp HP, AC, conditions, exhaustion and death saves are read from the sheet and written back to it.
  - The sheet's own rules apply: temp HP absorbs damage first, 0 HP means dying, three successful saves bring the PC back to 1 HP.
- **Tokens with number badges**: *Goblin 2* keeps its "2" after sorting.
- **Armies and minions**: run 40 goblins as **one row with a shared HP pool**, hit the whole group or several members at once, and watch the "27/40 standing" count drop.
- **Rim colours show the side**: blue = player, red = enemy, yellow = neutral NPC, green = ally. *Charmed* flips the colour.
- **Encounter cards**: write an encounter in a ` ```roll-encounter ``` ` block (Initiative Tracker syntax) and press **Roll Initiative**.
  - The card has players on the left and creatures on the right, with − / + steppers.
  - A badge shows the difficulty (*Easy / Medium / Hard / Deadly encounter*).
  - An optional **Roll for HP** checkbox rolls each creature's HP.
- **One combat note**: every fight goes into one *Roll Initiative* note. If a fight is still running, the plugin asks before overwriting it.
- **Auto-end**: combat ends by itself when every enemy is down.
- **Statblock pane**: click a monster's name to open its statblock in the sidebar.
- **Add box with suggestions**: type `3 gob` and press Enter to add 3 Goblins.
- **Atlas VTT**: start fights from Atlas encounters and keep initiative, HP and conditions in sync with an open Atlas map.
- **Game systems**: switch between D&D 5e (2024) and Cyberpunk RED in Settings.

| Encounter card | Damage / heal box |
|---|---|
| ![Encounter card](docs/screenshots/encounter-card.png) | ![HP box](docs/screenshots/hp-editor.png) |

### Armies and minions (groups)

Large battles stay manageable: a **group** is one row for many identical creatures. They share one initiative and one **HP pool** (HP each × how many).

- **Make a group** in any of these ways:
  - on an encounter card, click the 👥 button next to a creature with a count above 1;
  - in the add box, type `40 gob group`;
  - in the block, write `40x [[Goblin Warrior]] group`;
  - in the tracker, right-click creatures of the same kind → **Fight as one group**.
- **The tag** next to the name shows how many are still standing (`👥 27/40`). That's the pool divided by HP each, rounded up.
- **Damage box** for a group:
  - **Damage** comes off the shared pool.
  - **Area** deals the amount to each of **×** targets (empty = everyone standing): *Fireball for 28 on 6 goblins* = 6 goblins down. One member never loses more than its own HP.
  - **−1** drops members (type a number to drop more).
  - **Heal** puts HP back into the pool.
  - **Each** sets HP each and refills the group.
- **Splitting**: right-click → **Split into individual creatures** turns the survivors back into normal rows. The last one keeps the damage the pool had taken.
- **Difficulty** counts every member of the group.
- **Auto-end** triggers when the pool hits 0.
- **Cyberpunk RED**: one SP value for the whole group, Body / Head / Direct hits come off the pool, and Area hits each target through body SP.

![A group of 40 goblins in a fight](docs/screenshots/groups.png)

### Cyberpunk RED mode

Settings → Roll for Initiative → **Game system** → *Cyberpunk RED*. In this mode:

- **Initiative** is 1d10 + REF. Bonuses such as a Solo's *Combat Awareness* are added automatically.
- **Armour**: each location has its own SP. A hit is marked **Body**, **Head** or **Direct**:
  - damage over the SP gets through, and that SP drops by 1;
  - head hits double the damage that gets through;
  - Direct ignores armour.
- **Wounds**: *Seriously Wounded* and *Mortally Wounded* are applied automatically.
- **Death Saves**: a Mortally Wounded creature gets a **Death Save** button.
- **Critical Injuries** deal their 5 bonus damage when you add them as a condition.
- **Player notes**: everything is read from and written to the note's properties. It works with the *Cyberpunk RED Character Sheet* plugin.

![Cyberpunk RED mode](docs/screenshots/cyberpunk.png)

---

## Installation

Roll for Initiative is **not in the Community plugins list yet**, so you can't install it from **Browse** in Obsidian. Use one of these two ways.

### Option A: BRAT (recommended; installs and updates inside Obsidian)

1. In Obsidian, open **Settings → Community plugins** and turn off **Restricted mode** if it is on.
2. Click **Browse**, search for **BRAT** (*Obsidian42 - BRAT*), then **Install** and **Enable** it.
3. Open **Settings → BRAT → Add Beta plugin**.
4. Paste this repository's address: `https://github.com/YOUR-GITHUB-USERNAME/roll-initiative`
5. Click **Add Plugin**. BRAT downloads the latest release.
6. Go to **Settings → Community plugins** and switch on **Roll for Initiative**.

BRAT checks for new releases when Obsidian starts. You can also run **BRAT: Check for updates** from the command palette.

### Option B: by hand

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](../../releases/latest).
2. In your vault, create the folder `.obsidian/plugins/roll-initiative/`. The `.obsidian` folder is hidden: turn on hidden files in your file manager.
3. Put the three files in that folder.
4. Restart Obsidian, or run **Reload app without saving**, then go to **Settings → Community plugins** and switch on **Roll for Initiative**.

To update, replace the three files with the ones from the new release.

### Recommended companion plugins

| Plugin | Why |
|---|---|
| [Fantasy Statblocks](https://github.com/valentine195/obsidian-5e-statblocks) | Monster statblocks: the stat source and the statblock pane |
| One DnD Character Sheet | Live D&D 2024 player sheets (HP, conditions, death saves) |
| Cyberpunk RED Character Sheet | Live Cyberpunk RED player sheets |
| Atlas VTT | Battle maps; encounters and live token sync |

None of them is required. Without them, type HP and AC into the block yourself.

---

## Quick start

1. Open the command palette (Ctrl/Cmd + P) and run **Roll for Initiative: Insert combat block**. Or create an encounter card with an empty block:

   ````
   ```roll-encounter
   ```
   ````

   ![Setup card](docs/screenshots/setup-card.png)

2. Pick your party, type monsters into the **Add creature** box (`3 gob` = 3 Goblins), then press **Roll Initiative**.
3. Use **Next** / **‹** to move through turns.
   - Click a creature's HP to deal damage or heal it.
   - Hover over a row to add conditions.
   - Press **■** to end the fight.

### The block format

The format comes from Quick Initiative. A filled block looks like this:

````
```roll-encounter
name: Ambush at the old mill
party: The Lantern Company
creatures:
  - 3: [[Goblin Warrior]]
  - 1: [[Bandit Captain]]
  - 1: [[Wolf]], ally
```
````

During a fight, the tracker keeps the combat as readable text:

````
```roll-initiative
name Ambush at the old mill
round 2
> Goblin Warrior 1 [[Goblin Warrior]] init 16 hp 4/10 ac 15 (Prone, Frightened:2)
[[Dexar]] player init 14
[[Wolf]] init 11 hp 11/11 ac 12 ally
```
````

The **[full guide](docs/GUIDE.md)** covers everything else:
- every token of the block syntax;
- all the controls;
- the settings;
- Atlas VTT sync;
- the Cyberpunk RED rules;
- the events other plugins can listen to.

---

## Settings

| Setting | What it does |
|---|---|
| Game system | D&D 5e (2024) or Cyberpunk RED |
| Roll Initiative note | The note every fight is written to (default `Roll Initiative.md`) |
| Ask players for initiative | Opens a window to type each player's own roll |
| End combat when all enemies are down | Auto-end (on by default) |
| Monster / NPC / Players folders | Where to look for creatures, neutral NPCs and (Cyberpunk) player notes |
| Atlas VTT live sync | Mirrors the fight onto an open Atlas map |

---

## Credits

Roll for Initiative stands on the shoulders of these projects. Thank you to their authors.

- **[Quick Initiative](https://github.com/walkertbrown/quick-initiative)** by **walkertbrown** (Bananafest Destiny), MIT License. **This is the base plugin.** Roll for Initiative takes from it:
  - the idea of keeping the whole fight as plain text in a note;
  - the ` ```…``` ` block format and its tokens (`init`, `hp`, `ac`, `>`, `2x`, `(conditions)`);
  - the look and layout of the tracker.

  This is a separate plugin with its own code, built to add live character sheets, encounter cards, game systems and VTT sync. If you only need a light, fast tracker, use Quick Initiative.
- **[Initiative Tracker](https://github.com/valentine195/obsidian-initiative-tracker)** by **Jeremy Valentine** (javalent) gave us:
  - the `encounter` block syntax used by ` ```roll-encounter ``` `;
  - the sidebar creature view;
  - the idea of writing HP back to player notes.
- **[Initiative Tracker Plus](https://github.com/msweat254)** by **Mike** (msweat254), a community fork of Initiative Tracker, inspired the encounter card's behaviour.
- **[Fantasy Statblocks](https://github.com/valentine195/obsidian-5e-statblocks)** by **Jeremy Valentine** renders the statblock pane and supplies the bestiary.
- **Atlas VTT** by **[Fabian Urbanek](https://github.com/ByteMirror)** is the battle-map plugin the live sync talks to. **[Connect for Atlas VTT](https://github.com/evolJoaoBento)** by *Bento's Grimoire of Things* showed how to reach an open Atlas map.
- **One DnD Character Sheet** and **Cyberpunk RED Character Sheet** are companion plugins by the same author as this one.

The full list, with licences, is in [CREDITS.md](CREDITS.md).

## Disclaimer

This is an unofficial fan project.
- *Dungeons & Dragons* is a trademark of Wizards of the Coast.
- *Cyberpunk RED* is a trademark of R. Talsorian Games.
- No game text or art ships with this plugin. The screenshots use made-up characters and generated tokens.

## License

[MIT](LICENSE) © 2026 Majsnic
