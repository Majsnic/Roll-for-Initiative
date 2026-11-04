# Credits

Roll for Initiative is an independent plugin with its own code. It builds on ideas, formats and conventions from the projects below.

## Base plugin

### Quick Initiative
- **Author:** walkertbrown (Bananafest Destiny)
- **Repository:** https://github.com/walkertbrown/quick-initiative
- **License:** MIT
- **What we use:**
  - the concept of a fight stored as plain text in a note's code block;
  - the block syntax (`>` for the current turn, `2x` / `x2` counts, `init`, `hp cur/max`, `ac`, `(Condition:rounds)`, `player`);
  - the overall look of the tracker (round badge, initiative circles, HP pill, condition chips).

Quick Initiative is distributed under the MIT License. Its permission notice reads:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

## Other inspirations and integrations

| Project | Author | Used for |
|---|---|---|
| [Initiative Tracker](https://github.com/valentine195/obsidian-initiative-tracker) | Jeremy Valentine (javalent) | `encounter` block syntax (used by `roll-encounter`), sidebar creature view, HP sync to player notes |
| [Initiative Tracker Plus](https://github.com/msweat254) | Mike (msweat254) | Encounter card behaviour |
| [TTRPG Tools – Player Screen](https://github.com/jareika/ttrpg-tools-screen) | Jareika (Johannes Schwartz) | The second-screen window that shows the players' view of the fight (through its public `sendMarkdown` API) |
| [Fantasy Statblocks](https://github.com/valentine195/obsidian-5e-statblocks) | Jeremy Valentine (javalent) | Statblock rendering in the side pane, bestiary lookups, the `statblock` block format |
| Atlas VTT | [Fabian Urbanek](https://github.com/ByteMirror) | Battle maps; encounters and live token sync |
| Connect for Atlas VTT | [Bento's Grimoire of Things](https://github.com/evolJoaoBento) | Showed how to talk to an open Atlas map |
| [Obsidian](https://obsidian.md) | Dynalist Inc. | The app and its plugin API |

Roll for Initiative bundles no code from these projects. It only reads their data or calls their public behaviour when they are installed.

## Trademarks

- *Dungeons & Dragons* and *D&D* are trademarks of Wizards of the Coast LLC.
- *Cyberpunk* and *Cyberpunk RED* are trademarks of CD PROJEKT S.A. and R. Talsorian Games, Inc.

This plugin is unofficial and is not endorsed by any of them.
