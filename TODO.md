# TODO

Fixes for running this fork against *The Divine Fools* (dnd5e 3.1.1, Foundry v11).

Background: on connect the server gets the world's **stored** data over Socket.IO. Values that dnd5e **calculates** in the browser (character level, ability modifiers, often max HP and AC) are not in that data. Owned items are: every actor's items come down with the world data as `actor.items`.

**Principle:** show what Foundry stores; don't re-implement game rules. Calculated values (modifiers, proficiency, AC, derived max HP) are out of scope, because they're system-specific and may change completely after the planned Foundry upgrade. Where a value isn't stored, say "not stored" rather than "Unknown" or a guess.

Sections are in order of priority.

## 1. Owned items, features and spells can't be read

- **Where:** no tool exists. The data is in `worldData.actors[].items`.
- **Tested 2026-11-11:** there is no way to see what a character owns. `get_actor_details` returns no items, and `search_items` only searches the world's Items sidebar, not actors. So player features (class and racial features, feats), prepared spells, inventory and custom homebrew items on a character are all invisible. The existing `update_actor_item` and `delete_actor_item` tools need an item id, which nothing returns.
- **To do:**
  - [x] Add `getActorItems(actorId)` to `FoundryClient`.
  - [x] Add a read-only `get_actor_items` tool (definition in `definitions.ts`, handler in `src/tools/handlers/`, registered in the router).
  - [x] Per item return: id, name, type, and the stored fields that matter at the table: quantity, equipped, attuned, uses (`system.uses.value` / `max` as stored), and for spells the level, school and preparation mode.
  - [x] Optional `type` filter (`weapon`, `equipment`, `consumable`, `spell`, `feat`, `class`, `subclass`, `loot`, `tool`, `backpack`, …) and `query` filter on name.
  - [x] Group the output by type; spells grouped by spell level.
  - [x] Optional `itemId` argument to return one owned item in full: description text, activation, range, target, duration, damage formulas and requirements, all as stored.
  - [x] Build a shared HTML-to-text helper for descriptions (headings, lists, line breaks, decoded entities such as `&amp;`). Sections 2, 5 and 6 reuse it.
  - [x] Update the `get_actor_details` description, which currently says no tool lists owned-item ids.
  - [x] Look at RN0000/foundryvtt-mcp's `getActorItems` / inventory handler (MIT) as a starting point.
  - [x] Tests, including a spellcaster fixture and a homebrew feature.

## 2. World items (sidebar) only show name and type

- **Where:** `handleSearchItems` / `searchItems` in `src/foundry/client.ts`; `foundry://items` resource.
- **Tested 2026-11-11:** the world has 103 spells and 44 features in the Items sidebar, many of them custom (e.g. "Aura of Selune", "Acidic Bile Sprayer"). `search_items` returns only name, type and a meaningless "Common" / "Unknown price". No id and no description, so the text of a custom feature or spell can't be read. `searchItems` already extracts the description but the handler never prints it. Duplicate names (two "Arcane Vigor") can't be told apart.
- **To do:**
  - [x] Print each item's `_id` and folder name in `search_items`.
  - [x] Drop the made-up "Common" rarity and "Unknown price"; print stored rarity and price only when set.
  - [x] Add a read-only `get_item` tool (by id) returning the full stored item: description and the same fields as the `itemId` mode of `get_actor_items`. Share the formatting code between the two.
  - [x] Include item description text in `search_items` matching (optional `searchText` flag), like `search_journals` does for pages.
  - [x] Update tool descriptions.

## 3. `search_actors` doesn't return ids

- **Where:** `handleSearchActors` in `src/tools/handlers/actors.ts`.
- **Problem:** Needed to use `get_actor_items` (1), which takes an actor id. Claude has to read the `foundry://actors` resource, which only lists the first 100 of the world's 440 actors, to find an actor's id.
- **To do:**
  - [x] Print each actor's `_id` in the search results.
  - [x] Update the tool description.

## 4. Character level is always "Unknown"

- **Where:** `worldActorToFoundry` in `src/foundry/client.ts` reads `system.details.level`.
- **Problem:** In dnd5e 3.x a character's level is not stored on the character. It's the sum of `system.levels` on the actor's items of type `class`. NPCs use `system.details.cr` instead.
- **To do:**
  - [x] For `character` actors, sum `system.levels` over owned `class` items. This only adds up stored numbers, so it stays within the "no rules" principle. Keep the dnd5e-specific lookup in one small function so it's easy to replace after the upgrade.
  - [x] Also return the class breakdown (e.g. "Fighter 5 / Rogue 2") and subclass names (`subclass` items, linked by `system.classIdentifier`).
  - [x] For `npc` actors, show CR instead of level.
  - [x] Keep `system.details.level` as a fallback for other game systems.
  - [x] Show it in both `search_actors` and `get_actor_details`.
  - [x] Tests with a multiclass character fixture.

## 5. Journals are cut off at 500 characters

- **Where:** `src/tools/handlers/journals.ts`, `handleGetJournal`: `.slice(0, 500)`, plus the matching note in `src/tools/definitions.ts` (`get_journal` description).
- **Problem:** Each page is HTML-stripped and cut to 500 characters, with a trailing `...`. The full text is already in `worldData.journal`.
- **To do:**
  - [ ] Remove the hard cut and return each page in full.
  - [ ] Add optional `pageId` / `pageName` arguments to fetch a single page.
  - [ ] Add optional `offset` and `maxChars` arguments (with a generous default) so very long pages can be read in parts, and say in the output when there is more.
  - [ ] Use the HTML-to-text helper from 1 instead of deleting all tags.
  - [ ] Handle non-text pages (image, video, PDF) by printing their type and source instead of an empty body.
  - [ ] Update the tool description in `definitions.ts`.
  - [ ] Tests: a page longer than 500 characters comes back whole; paging returns consecutive parts.

## 6. Actor description is always empty

- **Where:** `handleGetActorDetails` in `src/tools/handlers/actors.ts`.
- **Problem:** The handler prints `actor.description`, but `worldActorToFoundry` stores the text as `actor.biography`, so it always says "No description available."
- **To do:**
  - [ ] Read `biography`, convert its HTML with the helper from 1.
  - [ ] Fix the tool description in `definitions.ts`, which says no description is returned.

## Optional: compendium content can't be read

- **Tested 2026-11-11:** `search_compendium` returns nothing; it only works through the REST API module (`FOUNDRY_API_KEY`), which isn't installed.
- **Open question:** are any homebrew spells, features or items kept only in world compendiums? If not, this can wait.
- **To do (if needed):**
  - [ ] Read compendium indexes and documents over the existing Socket.IO connection instead of the REST module (`modifyDocument` with action `get` and a `pack` in the operation). Verify this works on v11 for an Assistant GM user before building on it.
  - [ ] List packs, search a pack index by name, and fetch one entry in full with the same formatting as `get_item`.

## Afterwards

- [ ] Test everything read-only against the live world.
- [ ] Decide whether to offer these back to laurigates/foundryvtt-mcp as separate pull requests (one per numbered section).
