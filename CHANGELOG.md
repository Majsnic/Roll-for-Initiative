# Changelog

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
