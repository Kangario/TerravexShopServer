/**
 * Shared catalog of unique item effects.
 * Can be reused by other servers via: require("./shared/effectsCatalog")
 */
const { createModifier, ModifierOperation, ModifierStat } = require("./modifier");

const EFFECTS_CATALOG = Object.freeze([
  {
    ID: ""
  }
]);

function getEffectById(id) {
  return EFFECTS_CATALOG.find((e) => e.ID === id) || null;
}

module.exports = {
  EFFECTS_CATALOG,
  getEffectById,
};

