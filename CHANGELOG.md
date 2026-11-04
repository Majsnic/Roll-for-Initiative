# Changelog

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
