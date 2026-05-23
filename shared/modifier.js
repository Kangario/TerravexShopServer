/**
 * Shared modifier model (extracted for easy reuse/move).
 */
const ModifierOperation = Object.freeze({
  Add: "Add",
  Multiply: "Multiply",
  Override: "Override",
});

const ModifierStat = Object.freeze({
  DamageP: "DamageP",
  DamageM: "DamageM",
  DefenceP: "DefenceP",
  DefenceM: "DefenceM",
  Initiative: "Initiative",
  MoveCost: "MoveCost",
  MaxAP: "MaxAP",
  HpMax: "HpMax",

  // Skill-specific / utility
  TeleportCells: "TeleportCells",
  AttackRange: "AttackRange",
});

function createModifier({ Stat, Value, Duration, Source }) {
  return Object.freeze({
    Stat,
    Value: Number(Value) || 0,
    Duration: Number(Duration) || 0,
    Source: Source ?? null,
  });
}

module.exports = {
  ModifierOperation,
  ModifierStat,
  createModifier,
};

