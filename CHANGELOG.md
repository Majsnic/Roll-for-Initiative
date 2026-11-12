# Changelog

## 1.8.0
- **Several initiatives at once.** When you roll a new encounter while one is running, choose **Run alongside**. Each fight gets its own note (`Roll Initiative 2.md`, …).
  - **Switching:** **‹ ›** arrows at the top of the sidebar switch between the initiatives. A dot shows which one has the turn.
  - **One shared turn order:** turns go by initiative across all of them. A player on 20 in one fight is followed by a monster on 19 in the other, and the sidebar follows the turn there by itself. Rounds are shared.
  - **Waiting initiatives** say so, and their marker shows who acts next there.
  - **Ending one** passes the turn on. The last one left becomes a normal fight again.
  - **Player screen** shows the initiative whose turn it is.
  - **Who takes the damage?** offers targets from the roller's own fight.
  - **API:** state gains `waiting` and `initiatives`.
- **A player can turn against the party.** A character's token menu now has an **Enemy (red)** item to tick or untick.
  - A turned character gets a red rim and an **ENEMY** tag, and stays synced with their sheet.
  - They're counted as an enemy (damage targets, auto-end at 0 HP).
  - Stored as `player enemy` in the block.

## 1.7.5
- **Health bar:** a fourth colour, **orange**, when a creature is **bloodied** (half its max HP or less). The full scale is now: green at full HP, yellow when damaged, orange at half or less, red at a quarter or less (critical). Tracker and player screen.

## 1.7.4
- **Health bar colours:** **green** at full HP, **yellow** as soon as a creature is damaged, **red** at a quarter of max HP or less (critical). This applies in the tracker and on the player screen.

## 1.7.3
- **Fix (Atlas VTT):** One DnD Character Sheet 1.8 links each character's Atlas token to a statblock file it writes for Atlas (`<data folder>/<id>/Atlas.md`). Starting a fight from Atlas turned every character into a creature called "Atlas". Those tokens now become the right player characters again, and the live map sync matches them to their tokens.

## 1.7.2
Checked against One DnD Character Sheet 1.8.0:
- **Fix:** sheet 1.8 spell rows are laid out differently, and "Who takes the damage?" showed the casting time ("1A") instead of the spell's name. It now shows the spell or weapon name again.
- Healing vs damage and the damage type (now written after the dice again, with no separate Type column) are read correctly from the Spells and Actions tabs.

## 1.7.1
Checked against One DnD Character Sheet 1.7.0:
- **Fix:** sheet spell rows now show only the dice ("2d8", not "2d8 Healing"). "Who takes the damage?" now reads the spell note's *Damage / Effect*, so healing spells ask **Who takes the heal?** and damage spells keep their type (Fire, Thunder…).
- The sheet's new **Cast** button puts *Concentrating* on the character, and Roll for Initiative picks it up right away (badge, list, save cards).

## 1.7.0
**Concentration at a glance**
- A purple **Concentrating** badge on everyone concentrating (click it to end concentration), and a strip at the top of the tracker that lists them.
- When someone concentrating loses HP, a card shows the Constitution save DC with a **Roll CON save (+X)** button.
  - The CON bonus comes from the character sheet's saving throws, or the statblock's saves / CON score.
  - The card says whether they keep or lose concentration, and a lost save removes the condition.
  - The roll goes through the dice hook, so it shows in the GM screen's tray.
- Concentration ends by itself at 0 HP.
- The player screen shows players their own characters' badge and strip. Monsters' concentration stays hidden, because concentrating is silent in the fiction. Show it with *Settings → Player screen → Show monsters' concentration on the player screen*.
- The old *Concentration reminder* setting is now *Settings → Combat → Concentration at a glance*.
- API: `getState()` combatants now include `concentrating` and `conSave`.

## 1.6.0
**"Who takes the damage?"**

During a fight, a damage or healing roll asks who takes it. It catches rolls from:
- the Game Master Interactive Screen's dice tray;
- One DnD Character Sheet roll buttons;
- Fantasy Statblocks actions (through Dice Roller).

How it works:
- Click a creature to apply the damage or healing.
- *Several targets…* applies to many at once.
- *½* halves the damage for saves and resistance.
- The likely targets are listed first.
- It works with character sheets, groups and Cyberpunk armour.

Also:
- With the GM screen installed, rolls are taken from its `game-master-screen:rolled` event. Without it, Roll for Initiative reads Dice Roller itself, and you never get the question twice.
- New setting: *Ask who takes rolled damage / healing* (on by default).
- New API call: `applyRoll(roll)`.
- Fix: the New combat window now shows its accent colours.

## 1.5.0
**API for other plugins** (`app.plugins.plugins["roll-initiative"].api`)

New calls:
- `version`
- `getState(sourcePath?, id?)`: full fight state, including `running`, `ended`, `current`, `next`, and per combatant `disp`, `hidden`, `off`, `temp`, `current` and `group`
- `newCombat(options?)`: opens the New combat window and resolves with what was created
- `addCombatant(line, target?)`
- `rollInitiative(target?)`, `endCombat(target?)`, `showOnPlayerScreen()`

**Dice hook** `setRoller({ rollMany })`
- Initiative and rolled HP can be rolled by another plugin (e.g. a GM screen's dice tray).
- Roll-all is sent as one batch, and *Group initiative* is respected.
- Falls back to the built-in dice on errors, bad values or a 15 s timeout.

**Events**
- `roll-initiative:change` now carries the full state and also fires when a fight ends or the active fight switches.
- New `roll-initiative:created` event.

**Other changes**
- With *Ask players for initiative*, players left blank are rolled in the same batch as the monsters.
- New encounter notes get their block id right away.

Nothing changes when no other plugin uses the API.

## 1.4.0
**Player screen**

Show the initiative to your players with *TTRPG Tools – Player Screen*. Use the monitor button in the tracker, ⋮ → *Show on player screen*, or the command *Show initiative on player screen*.

- **Players see:**
  - round, order and current turn;
  - tokens and names;
  - PC / ally / neutral tags;
  - group counts and casualties;
  - health bars, conditions and death saves.
- **Players never see:** HP numbers, AC / SP, buttons, or hidden creatures.
- The view updates live with every change.
- New setting *Health bars on the player screen*: everyone / players only / nobody.

**Fixes**
- A hand-typed group line with a pool (`group 20 hp 155/200`) now reads 200 as the pool, not as HP each.

## 1.3.0
**New combat window (⚔ in the left ribbon)**

Step 1 asks what to prepare:
- **Combat encounter**: a full encounter note in your encounters folder, with the whole initiative order (a `roll-initiative` tracker).
- **Initiative tracker**: a compact prepared encounter with a Roll Initiative button (a `roll-encounter` card), shown as text with **Copy and Close** to paste into any note.

Step 2 sets it up:
- name and players (party, chosen characters or none);
- creatures with suggestions and − / +;
- army grouping (one by one / one group / groups of N);
- Roll for HP and the difficulty word.

New commands: *New combat*, *New encounter note*, *New initiative (text to paste)*. The sidebar still opens with the *Open initiative sidebar* command or from the window.

**Fixes**
- Folder settings written with Windows backslashes (`Dungeons & Dragons\04. Kniha příšer`) now work. Before, monster suggestions came up empty.

## 1.2.0
**Armies**
- Split an army into several groups: on the encounter card, the 👥 button opens a menu with these choices:
  - one by one;
  - one group;
  - groups of 5 / 10 / 20 / 25 / 50;
  - a custom size.

  For example, 50 goblins in groups of 10 = 5 group rows. YAML: `- 50: [[Goblin]], group 10`.
- **Casualties**: a red **−N** floats over a group's HP bar when members go down (green **+N** when healed back up).
- Right-click a group → **Split into smaller groups…**

**Settings**
- New **Armies & minions** section: *Group size*, *Group automatically from*, *Show casualties*.
- New **Encounters folder** setting, plus a **New encounter note** command (also in settings and in the tracker's ⋮ menu) that creates an encounter note there.

**Card**
- Full creature name on hover when the card is too narrow to show it.

## 1.1.0
**Armies and minions: groups**

A group is one row for many identical creatures, with a shared HP pool and a "standing" count (`👥 27/40`).

Ways to create one:
- the 👥 toggle on encounter card rows;
- `40 gob group` in the add box;
- `40x [[Goblin]] group` in the block;
- right-click → *Fight as one group*.

Group damage box:
- **Damage** comes off the pool;
- **Area** hits × targets for the full amount each;
- **−1** drops members;
- **Heal**;
- **Each** sets HP per member.

Also:
- Right-click → *Split into individual creatures* turns a group back into rows.
- Difficulty counts every member; auto-end when the pool is empty.
- Cyberpunk RED groups: hits through SP come off the pool, and Area hits each target.

Block syntax: `group N`, `each N` (also `mob`, `minions`, `horde`). Encounter YAML: `- 40: [[Goblin]], group`.

## 1.0.1
- **CSS lint clean:**
  - removed `subgrid`, `display: contents`, `column-gap` and `!important` from `styles.css`;
  - the encounter card still lines up its HP / AC / CR / class columns: the plugin now measures each column and sets its width through CSS variables;
  - long creature names now fit better on the card.
- **No inline styles:** HP bar widths and the hidden *Roll for HP* option now use CSS variables and classes.

## 1.0.0
First public release.

**Tracker**
- Fight stored as plain text in a `roll-initiative` block (Quick Initiative format), runnable in the note or in the sidebar.
- Monster stats from Fantasy Statblocks `statblock` blocks, then frontmatter, then the bestiary. Statblock numbers always win.
- Tokens with portraits and number badges.
- Sides shown by rim colour (player / enemy / neutral / ally). *Charmed* flips the side.
- Auto-end when every enemy is down.

**Character sheets**
- Live two-way sync with One DnD Character Sheet: HP, temp HP, conditions and death saves.

**Encounters**
- `roll-encounter` cards: two columns, − / + steppers, a difficulty word, Roll for HP.
- One shared *Roll Initiative* note, with an overwrite prompt when a fight is still running.
- Statblock side pane.
- Add box with suggestions (`3 gob` = 3 Goblins).

**Atlas VTT**
- Fights from Atlas encounters.
- Live sync of initiative, HP and conditions with an open map.
- Atlas "Start fight" starts the fight here too.

**Game systems**
- New *Game system* setting: D&D 5e (2024) and Cyberpunk RED.
- Cyberpunk RED rules:
  - 1d10 + REF initiative;
  - SP per location with ablation, head ×2 and Direct hits;
  - wound states set automatically;
  - Death Saves and Critical Injuries.
- Works with the Cyberpunk RED Character Sheet plugin.
