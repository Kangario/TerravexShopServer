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
  Initiative: 0,

  HpMax: 0,
  DefenceP: 0,
  DefenceM: 0,

  DamageP: 0,
  DamageM: 0,

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

const HERO_DERIVED_BASE = Object.freeze({
  Initiative: HERO_DEFAULTS.Initiative,
  MoveCost: HERO_DEFAULTS.MoveCost,
  HpMax: HERO_DEFAULTS.HpMax,
  DefenceP: HERO_DEFAULTS.DefenceP,
  DefenceM: HERO_DEFAULTS.DefenceM,
  DamageP: HERO_DEFAULTS.DamageP,
  DamageM: HERO_DEFAULTS.DamageM,
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

function rollAttributes(rng) {
  const roll0to10 = () => Math.floor(rng() * 10) + 1; // inclusive 0..10
  return {
    Strength: roll0to10(),
    Dexterity: roll0to10(),
    Constitution: roll0to10(),
    Intelligence: roll0to10(),
    Wisdom: roll0to10(),
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
  HERO_DERIVED_BASE,
  cloneHeroDefaults,
  rollAttributes,
  getHeroAttributeUpgradeRules,
};

