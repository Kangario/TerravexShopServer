/**
 * Shared catalog of unique item effects.
 * Can be reused by other servers via: require("./shared/effectsCatalog")
 */
const EFFECTS_CATALOG = Object.freeze([
  {
    Id: "stun_aura",
    Name: "Оцепенение",
    Cost: 220,
    Modifiers: { MoveCost: 0 },
    Description: "MoveCost = 0",
  },
  {
    Id: "blood_rage",
    Name: "Кровавая ярость",
    Cost: 260,
    Modifiers: { DamageP: 15 },
    Description: "Урон физический +15",
  },
  {
    Id: "arcane_focus",
    Name: "Мистический фокус",
    Cost: 240,
    Modifiers: { DamageM: 15 },
    Description: "Урон магический +15",
  },
  {
    Id: "iron_skin",
    Name: "Железная кожа",
    Cost: 200,
    Modifiers: { DefenceP: 10 },
    Description: "Защита физическая +10",
  },
  {
    Id: "warding",
    Name: "Оберег",
    Cost: 200,
    Modifiers: { DefenceM: 10 },
    Description: "Защита магическая +10",
  },
  {
    Id: "swift_step",
    Name: "Стремительный шаг",
    Cost: 180,
    Modifiers: { Initiative: 3 },
    Description: "Инициатива +3",
  },
]);

function getEffectById(id) {
  return EFFECTS_CATALOG.find((e) => e.Id === id) || null;
}

module.exports = {
  EFFECTS_CATALOG,
  getEffectById,
};

