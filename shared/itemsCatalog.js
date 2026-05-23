/**
 * Shared catalog of items offered in the shop.
 * Items reference Effects only (no purchasable effects).
 */
const { getEffectById } = require("./effectsCatalog");

function getLogicEffect(effectId) {
  const effect = getEffectById(effectId);
  return effect ? effect.Effect : null;
}

const ItemType = Object.freeze({
  Weapon: "Weapon",
  Armor: "Armor",
  Trinket: "Trinket",
});

const ITEMS_CATALOG = Object.freeze([
  
]);

module.exports = {
  ItemType,
  ITEMS_CATALOG,
};

