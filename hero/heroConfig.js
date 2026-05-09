const HERO_ATTRIBUTE_KEYS = Object.freeze([
  "Strength",
  "Dexterity",
  "Constitution",
  "Intelligence",
  "Wisdom",
]);

const HERO_DEFAULTS = Object.freeze({
  Gender: 0,
  DeathCharges: 3,
  Lvl: 1,
  Xp: 0,
  StatUpPoints: 0,
  Initiative: 40,

  HpMax: 8,
  DefenceP: 0,
  DefenceM: 0,

  DamageP: 10,
  DamageM: 10,

  AttackRange: 1,
  MoveCost: 1,
  MaxAP: 6,

  Attributes: Object.freeze({
    Strength: 10,
    Dexterity: 10,
    Constitution: 10,
    Intelligence: 10,
    Wisdom: 10,
  }),

  Skills: Object.freeze([]),
  EquipmentSlots: Object.freeze({
    Weapon: {
      LeftHand: null,
      RightHand: null,
    },
    Armor: {
      Head: null,
      Body: null,
      Legs: null,
    },
  }),
});

function cloneHeroDefaults() {
  // Deep clone only where needed (arrays/objects). Numbers are primitive.
  return {
    ...HERO_DEFAULTS,
    Skills: [],
    EquipmentSlots: {
      Weapon: { LeftHand: null, RightHand: null },
      Armor: { Head: null, Body: null, Legs: null },
    },
    Attributes: { ...HERO_DEFAULTS.Attributes },
  };
}

function getHeroAttributeUpgradeRules() {
  // Cost model can be tuned later; kept uniform for simplicity.
  return {
    Strength: { pointCostPerUnit: 1, maxIncreasePerRequest: 1000 },
    Dexterity: { pointCostPerUnit: 1, maxIncreasePerRequest: 1000 },
    Constitution: { pointCostPerUnit: 1, maxIncreasePerRequest: 1000 },
    Intelligence: { pointCostPerUnit: 1, maxIncreasePerRequest: 1000 },
    Wisdom: { pointCostPerUnit: 1, maxIncreasePerRequest: 1000 },
  };
}

module.exports = {
  HERO_ATTRIBUTE_KEYS,
  HERO_DEFAULTS,
  cloneHeroDefaults,
  getHeroAttributeUpgradeRules,
};

