/**
 * Shared catalog of skills.
 * Can be reused by other servers via: require("./shared/skillsCatalog")
 */
const SKILLS_CATALOG = Object.freeze([
  {
    Id: "fireball",
    Name: "Огненный шар",
    Cost: 320,
    CooldownTurns: 2,
    Payload: { DamageM: 100 },
    Description: "Урон магический: 100. КД: 2 хода.",
  },
  {
    Id: "dash",
    Name: "Скачек",
    Cost: 280,
    CooldownTurns: 3,
    Payload: { TeleportCells: 2 },
    Description: "Телепорт на 2 клетки в любом направлении. КД: 3 хода.",
  },
  {
    Id: "power_strike",
    Name: "Силовой удар",
    Cost: 260,
    CooldownTurns: 2,
    Payload: { DamageP: 70 },
    Description: "Урон физический: 70. КД: 2 хода.",
  },
  {
    Id: "frost_bolt",
    Name: "Ледяная стрела",
    Cost: 300,
    CooldownTurns: 2,
    Payload: { DamageM: 80, MoveCostDebuffTurns: 1 },
    Description: "Урон магический: 80 и замедление на 1 ход. КД: 2 хода.",
  },
  {
    Id: "healing_wave",
    Name: "Волна исцеления",
    Cost: 310,
    CooldownTurns: 3,
    Payload: { Heal: 90 },
    Description: "Лечение: 90. КД: 3 хода.",
  },
  {
    Id: "stone_shield",
    Name: "Каменный щит",
    Cost: 240,
    CooldownTurns: 3,
    Payload: { DefenceP: 15, DefenceM: 10, DurationTurns: 2 },
    Description: "Защита + на 2 хода. КД: 3 хода.",
  },
]);

function getSkillById(id) {
  return SKILLS_CATALOG.find((s) => s.Id === id) || null;
}

module.exports = {
  SKILLS_CATALOG,
  getSkillById,
};

