# Roll for Initiative - full guide

Initiative tracker for Obsidian, built to work with **One DnD Character Sheet**.

- The fight is stored as plain text in a `roll-initiative` code block in your note. Edit it by hand or with the buttons.
- **Run in sidebar** (panel button on the block, or the swords ribbon icon) runs the same encounter from the right sidebar. Both views edit the same block.
- **Monsters**: AC, HP, hit dice, initiative modifier (`modifier`, else from DEX in `stats`), CR/XP and image are read from the note's ```` ```statblock ```` block. If a note has no statblock, the plugin falls back to frontmatter, then to the Fantasy Statblocks bestiary.
- **Player characters** made with the character sheet are **live**:
  - HP, temp HP, AC, initiative modifier, level, conditions, exhaustion and death saves come from the sheet's files.
  - Damage, healing, temp HP, conditions and death saves made in the tracker are written straight to the sheet, using the sheet's own rules (temp HP absorbs damage first; at 0 HP the PC is dying and Prone becomes Unconscious; healing swaps Unconscious back to Prone; 3 successful death saves = 1 HP).
  - Changes made on the sheet show up in the tracker immediately.

## Block syntax

````
```roll-initiative
name Sewer ambush
party The Lantern Company
2x [[Kuo-toa]]
Kuo-toa Whip [[Kuo-toa Whip]] hidden
Bandit hp 11 ac 12 init +1
```
````

After a roll, the plugin rewrites the block like this:

````
```roll-initiative
name Sewer ambush
id k3j9xq
round 2
> [[Dexar]] player init 17
Kuo-toa 1 [[Kuo-toa]] init 12 mod +0 hp 11/18 ac 13 (Restrained:2)
[[Brom]] player init 9
```
````

| Token | Meaning |
|---|---|
| `>` at line start | whose turn it is |
| `2x` / `x2` / leading `2` | add that many (numbered 1, 2…) |
| `group` / `group 40` | one row for the whole group with a shared HP pool (`40x [[Goblin]] group` or `[[Goblin]] group 40`); also `mob`, `minions`, `horde` |
| `each 10` | a group's HP per member (filled from the statblock); a group's `hp 263/400` is the pool |
| `[[Note]]` / `[[Note\|Alias]]` | link to a monster note or a character sheet |
| `player` / `pc` | player character (sheet PCs are detected automatically) |
| `init 15` / `init +3` | rolled initiative / modifier |
| `mod +2`, `dex 14` | initiative modifier, DEX score (tie-breaks) |
| `hp 11/18`, `temp 5`, `ac 13` | current/max HP, temp HP, AC (monsters & plain players) |
| `(Prone, Poisoned:3)` | conditions; `:3` = lasts 3 of its turns |
| `ally`, `hidden`, `off` | friendly, hidden from players, skipped |
| `xp 450`, `lvl 4` | override XP / level for difficulty |
| `party` / `party The Lantern Company` | adds a Party Group from the character sheet's settings |
| `round 2`, `name …`, `id …` | encounter state (managed by the plugin) |

For live sheet PCs only `init` is stored in the block. Everything else lives on the sheet.

## Controls

Roll Initiative looks and works like Quick Initiative. It adds tokens, live character sheets and a sidebar.

- **Roll initiative / Reroll** rolls immediately:
  - monsters roll d20 + their modifier;
  - players keep the initiative already written in the block, and anyone without one is rolled;
  - the list is sorted by initiative, then modifier, then DEX, and round 1 starts.
  - Turn on **Ask players for initiative** in settings to get a window for typing each player's roll. It's also in the header's ⋮ menu.
- **Next / ‹ / ■**: next turn, previous turn, end combat. Next skips disabled monsters and monsters at 0 HP. Condition durations tick down at the end of each creature's turn.
- **Initiative circle**: set a value or reroll one creature.
- **Token**:
  - the portrait comes from the statblock's `image` or the sheet's `cover`;
  - the rim is blue for PCs, red for enemies and green for allies;
  - when several creatures share one statblock, a small number shows which is which (taken from the name, so *Kuo-toa 2* keeps its 2 after sorting).
  - Click the token, or right-click the row, for: statblock, open note, hide, ally, disable, rename, duplicate, remove.
- **HP box**: Damage / Heal / Temp (and Max for monsters). In the field, Enter applies damage; `+5` then Enter heals.
- **+ condition** (appears on hover): condition names come from your vault's `#Condition` notes. Click a condition chip to remove it.
- **×** removes the creature.
- **Add box**:
  - type using the same syntax as the block;
  - ⌕ browses the monster library and character sheets;
  - 👥 adds a party.
- **Difficulty** under the encounter name: total XP and the 2024 rating (Low / Moderate / High).
- **Commands** (assign hotkeys to these): Insert combat block, Open initiative sidebar, Run combat from current note in sidebar, Next turn, Previous turn, End combat.

## Encounters → one Roll Initiative note

Write encounters with a `roll-encounter` block. It uses the same syntax as Initiative Tracker's `encounter` block, and `[[links]]` work without quotes:

````
```roll-encounter
name: Sewer ambush
party: The Lantern Company          # a Party Group from the character sheet (default: the first group)
creatures:
  - 3: [[Kuo-toa]]
  - 1: [[Kuo-toa Whip]], hidden
  - 1: [[Wolf]], ally
  - 2: Bandit, 11, 12, 1  # name, hp, ac, initiative modifier
```
````

Add `group` to fight a whole count as one row: `- 40: [[Goblin Warrior]], group` (or `group: true` in the long form). `group 10` splits the count into groups of 10 (`- 50: [[Goblin Warrior]], group 10` = 5 rows), and `single` keeps creatures one by one even when *Group automatically from* would group them.

**New encounter note** (command, settings button, or the tracker's ⋮ menu) creates a note with an empty encounter card in the **Encounters folder** from settings.

`players: [[[Dexar]], [[Brom]]]` or `players: none` work too. Several encounters can share one block, separated by `---`.

An **empty** ```` ```roll-encounter ```` block works too: it opens as a setup card.

- **Players dropdown**: one of your Party Groups, *Choose characters…* (tick any character sheets), or *No players*.
- **Add box**: suggests monsters as you type (`3 kuo` = 3 Kuo-toa).
- **− / +** on each creature changes how many there are.
- **Badge**: shows the difficulty as a word (*Trivial / Easy / Medium / Hard / Deadly encounter*, from the 2024 budgets).

Every change is written back into the block as YAML. Pressing **Roll Initiative**:

1. writes the fight into **one** note (`Roll Initiative.md` by default; set the path in settings);
2. if a combat is still running, first asks *"There is an active initiative already… Run the new one alongside it, or overwrite it?"* (Show current / Cancel / Overwrite / Run alongside). **Run alongside** puts the new fight in `Roll Initiative 2.md` and both share one turn order (see *Several initiatives at once* in the README). An ended combat is replaced without asking;
3. rolls initiative and opens the sidebar, plus the note itself if **Open the Roll Initiative note** is on in settings.

## Sides and colours

| Rim | Who |
|---|---|
| Blue | player characters |
| Red | enemies (default for monsters) |
| Yellow | neutral (default for NPC notes: `type: npc` or tagged `NPC`) |
| Green | allies |

- Change sides with the token menu (Enemy / Neutral / Ally). The choice is stored in the block as `enemy` / `neutral` / `ally`.
- **A player who turns against the party:** a character's token menu has an **Enemy (red)** item. Tick it, or untick it to bring them back.
  - A turned character gets a red rim and an **ENEMY** tag, in the tracker and on the player screen.
  - Stored as `player enemy` in the block. The character stays live with their sheet.
  - They count as an enemy: listed with the enemies in *Who takes the damage?*, and the combat only auto-ends once they're down too (0 HP).
- **Charmed** flips a creature's rim to the other side: a charmed monster turns green, a charmed PC turns red, and a small ♥ shows why.
- Only enemies count toward difficulty and toward auto-end.

## Ending combat

- ■ marks the initiative as **Ended**. The round pill shows "Ended", and `ended` is stored in the block.
- With **End combat when all enemies are down** on (the default), the combat ends by itself as soon as every red creature is at 0 HP.
- **Roll initiative** starts the fight again.

## Statblocks

Clicking a monster's name, in the tracker or on an encounter card, opens its statblock in a pane in the right sidebar under the tracker. It's rendered by Fantasy Statblocks, like Initiative Tracker's creature view. Ctrl/Cmd-click opens the note instead. Player names still open their character sheet.

## Add box

Start typing and it suggests character sheets, monsters from your monster folder, and NPCs. `3 kuo` + Enter adds 3× Kuo-toa, and the box keeps focus, so you can keep adding. The last suggestion always adds exactly what you typed, so the block syntax (`Bandit hp 11 ac 12`) still works.

## Atlas VTT

**Atlas encounters → fights**
- Encounter cards get a **From Atlas** button. It fills the card from an Atlas encounter:
  - monsters come from each token's statblock note;
  - character tokens are matched to your character sheets by name, first name or token image.
- The command **Roll initiative for an Atlas encounter** starts a fight straight from one.

**Live map sync** (Settings → Atlas VTT, on by default). While a fight runs and an Atlas map is open:
- Roll for Initiative → map: initiative order, current turn, round, HP (PCs from their sheets) and conditions are mirrored onto the matching tokens.
- Map → Roll for Initiative: HP and conditions changed on the map come back. A PC's go onto their character sheet too, with the same dying / Unconscious rules as the sheet.
- How tokens are matched to combatants:
  - monsters by their statblock note;
  - characters by name or image;
  - anything else by name.

  Tokens that aren't in the fight are left alone.
- Atlas has no public API yet, so the sync talks to the open map's internal store, the same way *Connect for Atlas VTT* does. If an Atlas update breaks it, switch the setting off. The fight itself is never affected.


## Game system

Settings → Roll for Initiative → **Game system** switches the rules the plugin uses for that vault.

**D&D 5e (2024)** (default): everything above.

**Cyberpunk RED**
- Initiative is 1d10 + REF. Statblock `initiative: 1d10 + N` is read as +N. An `init_bonus` property or a role ability reading "+4 to every Initiative" (Combat Awareness) is added for players.
- Creatures are read from frontmatter:
  - `hp`, `hp_current`, `ref`, `dex`, `body`;
  - `sp_head` / `sp_body` (or `sp`);
  - `role` + `rank` for players, `threat` for mooks.
- PCs are notes with `type: player` or notes in the **Players folder**. HP, SP, conditions and death-save penalty are written back to the note.
- NPCs are `type: npc` or notes in the **NPC folder** (yellow rim).
- The HP box offers **Body / Head / Direct / Heal**:
  - damage is reduced by the SP of that location;
  - head hits deal double damage;
  - armour ablates by 1 when it's penetrated;
  - Direct ignores armour.
- *Seriously Wounded* (below half HP) and *Mortally Wounded* (below 1 HP) are applied automatically.
- Adding a Critical Injury condition (a `type: condition` note whose `quality` is *Critical Injury (Head/Body)*) also deals 5 bonus damage to HP and applies `death_save_penalty_base`.
- A hit on someone already Mortally Wounded adds +1 to their Death Save penalty.
- Conditions offered = every `type: condition` note in the vault.
- Works with the **Cyberpunk RED Character Sheet** plugin: writes go to the note's properties (`hp` stays the max) and fire `cpr-sheet:refresh`, so the sheet redraws at once.
- A Mortally Wounded creature gets a **Death Save** button. It rolls 1d10 + penalty against BODY; a 10 always fails, and each success adds +1 to the penalty.
- Encounter cards show SP instead of AC and Threat instead of CR. They have no difficulty badge and no Roll for HP.
- `party` uses everyone in the Players folder ("Crew").
- Block tokens added: `sp 11/11`, `body 7`, `dsp 1`.

## For other plugins

The full API (`getState`, `newCombat`, `addCombatant`, the dice hook `setRoller`, events) is documented in the README under **API for other plugins**.


- `app.workspace.on("roll-initiative:change", (state) => …)` fires on every change (round, current creature, combatants).
- To refresh the sheet, the plugin fires `dnd-sheet:main-file-changed`, and `dnd-sheet:conditions-changed` (the sheet's Conditions block listens for the latter since this release).

## Groups (armies and minions)

A group is one row for many identical creatures. They share initiative and an **HP pool** (HP each × size). The tag next to the name shows how many are still standing: the pool divided by HP each, rounded up.

- **Making one:**
  - the 👥 button on an encounter card row (count above 1);
  - `40 gob group` in the add box;
  - `40x [[Goblin Warrior]] group` in the block;
  - right-click → **Fight as one group**, which merges every creature with the same statblock and keeps their remaining HP.
- **HP box:**
  - **Damage** comes off the pool.
  - **Area** deals the amount to each of **×** targets (empty = all standing). Each member loses at most its own HP.
  - **−1** drops members (type a number to drop several).
  - **Heal** puts HP back into the pool.
  - **Each** sets HP each and refills the group.
- **Group sizes:** the 👥 button on a card opens a menu with these options:
  - **One by one**;
  - **One group**;
  - **Groups of 5 / 10 / 20 / 25 / 50**;
  - **Groups of…** for a custom size.

  With a size set, the button shows that size (`👥 10`).
- **Settings → Armies & minions:**
  - **Group size** is the default size when a creature is grouped (empty = everyone in one group);
  - **Group automatically from** starts counts at least this big as a group;
  - **Show casualties** floats a red **−N** over a group's HP bar when members go down (green **+N** when they come back).
- **Splitting** (right-click):
  - **Split into smaller groups…** divides the survivors into groups of N;
  - **Split into individual creatures** gives every standing member its own row again.

  Either way, the last row carries the pool's damage.
- **Difficulty** counts every member. Auto-end triggers when the pool is empty.
- **Atlas VTT:** live sync leaves group rows out, because a group has no single token.
- **Cyberpunk RED:**
  - the group shares one SP value, with no per-member ablation;
  - Body / Head / Direct hits come off the pool;
  - Area applies body SP to each target;
  - groups have no wound states or Death Saves.
