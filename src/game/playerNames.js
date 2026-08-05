/**
 * The single normalization every player-name comparison in this codebase
 * must use. Strips all whitespace, not just leading/trailing — a name typed
 * via the command bar's bracket syntax (`/kill [Alice Smith] bob`) keeps its
 * internal space, while the stored `trimmedNameLowerCase` key does not
 * (docs/data-model.md). A plain `.toLowerCase()` on one side and this on the
 * other silently fails to match on any multi-word name (docs/improvements.md
 * item 35).
 *
 * CommonJS export — see targetGraph.js's header comment; this file is also
 * `require()`d by the Cloud Function in functions/callableFunctions/
 * killPlayer.js (docs/improvements.md item 4).
 */
const normalizePlayerName = (name) => name.replace(/\s/g, '').toLowerCase();

module.exports = { normalizePlayerName };
