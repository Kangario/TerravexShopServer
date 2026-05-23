/**
 * Shared catalog of skills.
 * Can be reused by other servers via: require("./shared/skillsCatalog")
 */
const { getEffectById } = require("./effectsCatalog");

function getSkillEffect(effectId) {
  const effect = getEffectById(effectId);
  return effect ? effect.Effect : null;
}

const SKILLS_CATALOG = Object.freeze([

]);

function getSkillById(id) {
  return SKILLS_CATALOG.find((s) => s.ID === id) || null;
}

module.exports = {
  SKILLS_CATALOG,
  getSkillById,
};

