const { HERO_ATTRIBUTE_KEYS, cloneHeroDefaults, getHeroAttributeUpgradeRules } = require("./heroConfig");

function getHeroLevelUpXpRequired(level) {
  return 50 * level;
}

function addHeroXp(hero, xpToAdd) {
  if (!Number.isFinite(hero.Lvl) || hero.Lvl < 1) {
    hero.Lvl = 1;
  }

  if (!Number.isFinite(hero.Xp) || hero.Xp < 0) {
    hero.Xp = 0;
  }

  if (!Number.isFinite(hero.StatUpPoints) || hero.StatUpPoints < 0) {
    hero.StatUpPoints = 0;
  }

  hero.Xp += Math.floor(xpToAdd);

  let leveledUp = false;
  const previousLevel = hero.Lvl;

  while (hero.Xp >= getHeroLevelUpXpRequired(hero.Lvl)) {
    hero.Lvl += 1;
    hero.Xp = 0;
    hero.StatUpPoints += 5;
    leveledUp = true;
  }

  return { leveledUp, previousLevel };
}

function normalizeHero(hero) {
  const defaults = cloneHeroDefaults();
  let changed = false;

  if (!hero || typeof hero !== "object") {
    return { hero: defaults, changed: true };
  }

  // Ensure core numeric fields exist
  for (const key of [
    "Gender",
    "DeathCharges",
    "Lvl",
    "Xp",
    "StatUpPoints",
    "Initiative",
    "HpMax",
    "DefenceP",
    "DefenceM",
    "DamageP",
    "DamageM",
    "AttackRange",
    "MoveCost",
    "MaxAP",
  ]) {
    if (!Number.isFinite(hero[key])) {
      hero[key] = defaults[key];
      changed = true;
    }
  }

  // Grouped attributes container
  if (!hero.Attributes || typeof hero.Attributes !== "object") {
    hero.Attributes = { ...defaults.Attributes };
    changed = true;
  }

  for (const attr of HERO_ATTRIBUTE_KEYS) {
    if (!Number.isFinite(hero.Attributes[attr])) {
      hero.Attributes[attr] = defaults.Attributes[attr];
      changed = true;
    }
  }

  // Backward-compat: if attributes were stored at top-level ранее
  for (const attr of HERO_ATTRIBUTE_KEYS) {
    if (Number.isFinite(hero[attr]) && !Number.isFinite(hero.Attributes[attr])) {
      hero.Attributes[attr] = hero[attr];
      changed = true;
    }
    if (attr in hero) {
      delete hero[attr];
      changed = true;
    }
  }

  if (!Array.isArray(hero.Skills)) {
    hero.Skills = [];
    changed = true;
  }

  if (!hero.EquipmentSlots || typeof hero.EquipmentSlots !== "object") {
    hero.EquipmentSlots = {
      Weapon: { LeftHand: null, RightHand: null },
      Armor: { Head: null, Body: null, Legs: null },
    };
    changed = true;
  } else {
    if (!hero.EquipmentSlots.Weapon || typeof hero.EquipmentSlots.Weapon !== "object") {
      hero.EquipmentSlots.Weapon = { LeftHand: null, RightHand: null };
      changed = true;
    }
    if (!hero.EquipmentSlots.Armor || typeof hero.EquipmentSlots.Armor !== "object") {
      hero.EquipmentSlots.Armor = { Head: null, Body: null, Legs: null };
      changed = true;
    }
  }

  return { hero, changed };
}

function getRequestedHeroAttributeUpgrades(body) {
  const rules = getHeroAttributeUpgradeRules();
  const stats = {};

  // Accept both flat payload and nested payload
  const payload =
    body?.Attributes && typeof body.Attributes === "object" ? body.Attributes :
    body?.attributes && typeof body.attributes === "object" ? body.attributes :
    body;

  for (const statName of Object.keys(rules)) {
    if (payload?.[statName] === undefined) {
      continue;
    }

    const value = Number(payload[statName]);
    if (!Number.isInteger(value) || value < 0) {
      return { error: `${statName} must be a non-negative integer` };
    }

    if (value > 0) {
      stats[statName] = value;
    }
  }

  return { stats };
}

function applyHeroAttributeUpgrades(hero, requestedStats) {
  if (!Number.isFinite(hero.StatUpPoints) || hero.StatUpPoints < 0) {
    hero.StatUpPoints = 0;
  }

  const rules = getHeroAttributeUpgradeRules();
  const appliedUpgrades = {};
  let spentStatUpPoints = 0;

  if (!hero.Attributes || typeof hero.Attributes !== "object") {
    hero.Attributes = {};
  }

  for (const [statName, increaseBy] of Object.entries(requestedStats)) {
    const rule = rules[statName];
    if (!rule) {
      return { ok: false, error: `Stat ${statName} is not supported` };
    }

    if (increaseBy > rule.maxIncreasePerRequest) {
      return {
        ok: false,
        error: `Too many points requested for ${statName}`,
        details: {
          stat: statName,
          requested: increaseBy,
          maxIncreasePerRequest: rule.maxIncreasePerRequest,
        },
      };
    }

    if (!Number.isFinite(hero.Attributes[statName])) {
      hero.Attributes[statName] = 0;
    }

    spentStatUpPoints += increaseBy * rule.pointCostPerUnit;
    appliedUpgrades[statName] = { increaseBy, pointCostPerUnit: rule.pointCostPerUnit };
  }

  if (spentStatUpPoints > hero.StatUpPoints) {
    return {
      ok: false,
      error: "Not enough StatUpPoints",
      details: {
        requiredStatUpPoints: spentStatUpPoints,
        currentStatUpPoints: hero.StatUpPoints,
      },
    };
  }

  for (const [statName, increaseBy] of Object.entries(requestedStats)) {
    hero.Attributes[statName] += increaseBy;
  }

  hero.StatUpPoints -= spentStatUpPoints;

  return { ok: true, spentStatUpPoints, appliedUpgrades };
}

function normalizeUserHeroes(user) {
  let changed = false;
  if (!user || typeof user !== "object") return { changed: false };

  const normalizeList = (heroes) => {
    if (!Array.isArray(heroes)) return;
    for (let i = 0; i < heroes.length; i++) {
      const res = normalizeHero(heroes[i]);
      heroes[i] = res.hero;
      if (res.changed) changed = true;
    }
  };

  normalizeList(user.heroesBought);
  normalizeList(user.equipmentHeroes);

  return { changed };
}

function syncUserHeroesProgress(user) {
  const norm = normalizeUserHeroes(user);
  let changed = norm.changed;
  let leveledUpCount = 0;

  const syncHeroList = (heroes) => {
    if (!Array.isArray(heroes)) return;
    for (const hero of heroes) {
      const previousLevel = Number.isFinite(hero.Lvl) ? hero.Lvl : 1;
      const previousStatUpPoints = Number.isFinite(hero.StatUpPoints) ? hero.StatUpPoints : 0;
      const progress = addHeroXp(hero, 0);

      if (progress.leveledUp) {
        leveledUpCount += 1;
        changed = true;
        continue;
      }

      if (hero.Lvl !== previousLevel || hero.StatUpPoints !== previousStatUpPoints) {
        changed = true;
      }
    }
  };

  syncHeroList(user.heroesBought);
  syncHeroList(user.equipmentHeroes);

  return { changed, leveledUpCount };
}

module.exports = {
  HERO_ATTRIBUTE_KEYS,
  normalizeHero,
  normalizeUserHeroes,
  getHeroLevelUpXpRequired,
  addHeroXp,
  getRequestedHeroAttributeUpgrades,
  applyHeroAttributeUpgrades,
  syncUserHeroesProgress,
};

