const express = require("express");
const crypto = require("crypto");
const { createClient } = require("redis");
const namePatterns = require("./namePatterns.json");
const { EFFECTS_CATALOG } = require("./shared/effectsCatalog");
const { SKILLS_CATALOG } = require("./shared/skillsCatalog");
const {
    normalizeUserHeroes,
    syncUserHeroesProgress,
    addHeroXp,
    getHeroLevelUpXpRequired,
    getRequestedHeroAttributeUpgrades,
    applyHeroAttributeUpgrades,
    recomputeDerivedStatsFromAttributes,
} = require("./hero/heroProgression");
const { HERO_ATTRIBUTE_KEYS, cloneHeroDefaults, rollAttributes } = require("./hero/heroConfig");

process.on("unhandledRejection", (reason) => {
    console.error("[Fatal] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("[Fatal] Uncaught exception:", error);
});

async function start() {
    const app = express();
    app.use(express.json());

    function logShop(event, payload) {
        try {
            console.log(`[Shop] ${event}`, JSON.stringify(payload));
        } catch {
            console.log(`[Shop] ${event}`, payload);
        }
    }

    const PORT = Number(process.env.PORT) || 8080;
    const HOST = process.env.HOST || "0.0.0.0";
    const REDIS_HOST = process.env.REDIS_HOST || "redis-17419.c328.europe-west3-1.gce.cloud.redislabs.com";
    const REDIS_PORT = Number(process.env.REDIS_PORT) || 17419;
    const REDIS_PASSWORD = process.env.REDIS_PASSWORD || "af0gO9r23iS9w7sYd8T0XtQktQR0ZXnl";

    const redis = createClient({
        socket: {
            host: REDIS_HOST,
            port: REDIS_PORT,
        },
        password: REDIS_PASSWORD,
    });

    let redisConnectPromise = null;

    redis.on("error", (err) => console.error("Redis error:", err));

    async function getRedis() {
        if (redis.isOpen) {
            return redis;
        }

        if (!redisConnectPromise) {
            redisConnectPromise = redis.connect()
                .then(() => {
                    console.log("✅ Redis connected");
                    return redis;
                })
                .catch((err) => {
                    redisConnectPromise = null;
                    throw err;
                });
        }

        return redisConnectPromise;
    }

    async function requireRedis(res) {
        try {
            return await getRedis();
        } catch (err) {
            console.error("[Redis] Connection failed:", err);
            res.status(503).json({ error: "Redis unavailable" });
            return null;
        }
    }

    app.get("/", async (req, res) => {
        res.json({
            ok: true,
            service: "terravexshop",
            redisConnected: redis.isOpen
        });
    });

    app.post("/shop/update", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: "userId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const userPatched = normalizeUserHeroes(user).changed;
            const now = Date.now();
            const UPDATE_INTERVAL = 6000 * 100;

            let shopSeed;
            let fromCache = false;
            
            if (
                user.lastShopUpdate &&
                user.shopSeed &&
                now - user.lastShopUpdate < UPDATE_INTERVAL
            ) {
                shopSeed = user.shopSeed;
                fromCache = true;
            }
            else {
                shopSeed = hashSeed(userId + Date.now());

                user.lastShopUpdate = now;
                user.shopSeed = shopSeed;

                await redis.set(userKey, JSON.stringify(user));
            }
            
            if (fromCache && userPatched) {
                await redis.set(userKey, JSON.stringify(user));
            }
            
            logShop("update.begin", {
                userId,
                fromCache,
                shopSeed,
                lastShopUpdate: user.lastShopUpdate,
            });

            const rng = mulberry32(shopSeed);

            const boughtIds = new Set(
                (user.heroesBought || []).map(h => h.Id)
            );

            const equippedIds = new Set(
                (user.equipmentHeroes || []).map(h => h.Id)
            );

            const heroes = [];
            for (let i = 0; i < 6; i++) {
                const hero = generateHero(rng, i, shopSeed);
                
                if (boughtIds.has(hero.Id)) {
                    continue;
                }
                
                if (equippedIds.has(hero.Id)) {
                    continue;
                }

                heroes.push(hero);
            }

            // Items & skills are generated from derived seeds (stable, independent of hero RNG usage).
            const itemsRng = mulberry32(hashSeed(`${shopSeed}:items`));
            const skillsRng = mulberry32(hashSeed(`${shopSeed}:skills`));

            const itemsBoughtIds = new Set((user.itemsBought || []).map((it) => it.Id));
            const skillsBoughtIds = new Set((user.skillsBought || []).map((sk) => sk.Id));

            const items = [];
            for (let i = 0; i < 6; i++) {
                const item = generateItem(itemsRng, i, shopSeed);
                if (itemsBoughtIds.has(item.Id)) {
                    continue;
                }
                items.push(item);
            }

            const skills = [];
            const usedSkillIds = new Set();
            for (let i = 0; i < 6; i++) {
                const offer = generateSkillOffer(skillsRng, i, shopSeed, usedSkillIds);
                if (!offer) continue;
                if (skillsBoughtIds.has(offer.Id)) continue;
                skills.push(offer);
            }

            logShop("update.generated", {
                userId,
                shopSeed,
                heroes: heroes.length,
                items: items.length,
                skills: skills.length,
            });

            const shopResponse = {
                ok: true,
                fromCache,
                shopSeed,
                heroes,
                items,
                skills
            };

            return res.json(shopResponse);

        } catch (err) {
            console.error("[Shop] Internal error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/shop/buy", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId, heroId } = req.body;

            if (!userId || heroId === undefined) {
                return res.status(400).json({ error: "userId and heroId required" });
            }

            const parsedHeroId = Number(heroId);
            if (!Number.isInteger(parsedHeroId)) {
                return res.status(400).json({ error: "Invalid heroId" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const userPatched = normalizeUserHeroes(user).changed;

            if (!user.shopSeed) {
                if (userPatched) {
                    await redis.set(userKey, JSON.stringify(user));
                }
                return res.status(400).json({ error: "Shop not generated yet" });
            }

            const now = Date.now();
            const UPDATE_INTERVAL = 6000 * 100;

            if (
                !user.lastShopUpdate ||
                now - user.lastShopUpdate > UPDATE_INTERVAL
            ) {
                return res.status(400).json({
                    ok: false,
                    error: "Shop expired, please refresh shop"
                });
            }

            const alreadyBought = user.heroesBought?.some(h => h.Id === parsedHeroId);
            if (alreadyBought) {
                return res.status(400).json({
                    ok: false,
                    error: "Hero already bought"
                });
            }

            logShop("buyHero.begin", { userId, heroId: parsedHeroId, shopSeed: user.shopSeed });

            // 🔁 Восстанавливаем магазин по сиду
            const rng = mulberry32(user.shopSeed);

            let foundHero = null;

            for (let i = 0; i < 6; i++) {
                const hero = generateHero(rng, i, user.shopSeed);
                if (hero.Id === parsedHeroId) {
                    foundHero = hero;
                    break;
                }
            }

            if (!foundHero) {
                return res.status(400).json({ error: "Hero not found in current shop" });
            }

            const price = calculateHeroPrice(foundHero);

            if (user.gold < price) {
                return res.status(400).json({
                    ok: false,
                    error: "Not enough gold",
                    requiredGold: price,
                    currentGold: user.gold
                });
            }

            // ✅ Покупка
            user.gold -= price;

            if (!Array.isArray(user.heroesBought)) {
                user.heroesBought = [];
            }

            user.heroesBought.push({
                ...foundHero,
                StatUpPoints: 0,
                InstanceId: crypto.randomUUID(),
                boughtAt: Date.now(),
                price
            });

            await redis.set(userKey, JSON.stringify(user));

            logShop("buyHero.ok", { userId, heroId: parsedHeroId, price, goldLeft: user.gold });

            return res.json({
                ok: true,
                hero: foundHero,
                price,
                goldLeft: user.gold
            });

        } catch (err) {
            console.error("[Shop] Buy error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/shop/buyItem", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) return;

            const { userId, itemId } = req.body;
            if (!userId || itemId === undefined) {
                return res.status(400).json({ ok: false, error: "userId and itemId required" });
            }

            const parsedItemId = Number(itemId);
            if (!Number.isInteger(parsedItemId)) {
                return res.status(400).json({ ok: false, error: "Invalid itemId" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);
            if (!rawUser) {
                return res.status(404).json({ ok: false, error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const userPatched = normalizeUserHeroes(user).changed;

            if (!user.shopSeed) {
                if (userPatched) await redis.set(userKey, JSON.stringify(user));
                return res.status(400).json({ ok: false, error: "Shop not generated yet" });
            }

            const now = Date.now();
            const UPDATE_INTERVAL = 6000 * 100;
            if (!user.lastShopUpdate || now - user.lastShopUpdate > UPDATE_INTERVAL) {
                return res.status(400).json({ ok: false, error: "Shop expired, please refresh shop" });
            }

            if (!Array.isArray(user.itemsBought)) user.itemsBought = [];
            if (user.itemsBought.some((it) => it.Id === parsedItemId)) {
                return res.status(400).json({ ok: false, error: "Item already bought" });
            }

            logShop("buyItem.begin", { userId, itemId: parsedItemId, shopSeed: user.shopSeed });

            const itemsRng = mulberry32(hashSeed(`${user.shopSeed}:items`));
            let foundItem = null;
            for (let i = 0; i < 6; i++) {
                const item = generateItem(itemsRng, i, user.shopSeed);
                if (item.Id === parsedItemId) {
                    foundItem = item;
                    break;
                }
            }

            if (!foundItem) {
                return res.status(400).json({ ok: false, error: "Item not found in current shop" });
            }

            const price = foundItem.Price;
            if ((user.gold ?? 0) < price) {
                return res.status(400).json({
                    ok: false,
                    error: "Not enough gold",
                    requiredGold: price,
                    currentGold: user.gold ?? 0,
                });
            }

            user.gold -= price;
            user.itemsBought.push({
                ...foundItem,
                InstanceId: crypto.randomUUID(),
                boughtAt: Date.now(),
                price,
            });

            await redis.set(userKey, JSON.stringify(user));

            logShop("buyItem.ok", { userId, itemId: parsedItemId, price, goldLeft: user.gold });

            return res.json({
                ok: true,
                item: foundItem,
                price,
                goldLeft: user.gold,
            });
        } catch (err) {
            console.error("[Shop] BuyItem error:", err);
            return res.status(500).json({ ok: false, error: "Internal server error" });
        }
    });

    app.post("/shop/buySkill", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) return;

            const { userId, skillId } = req.body;
            if (!userId || !skillId) {
                return res.status(400).json({ ok: false, error: "userId and skillId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);
            if (!rawUser) {
                return res.status(404).json({ ok: false, error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const userPatched = normalizeUserHeroes(user).changed;

            if (!user.shopSeed) {
                if (userPatched) await redis.set(userKey, JSON.stringify(user));
                return res.status(400).json({ ok: false, error: "Shop not generated yet" });
            }

            const now = Date.now();
            const UPDATE_INTERVAL = 6000 * 100;
            if (!user.lastShopUpdate || now - user.lastShopUpdate > UPDATE_INTERVAL) {
                return res.status(400).json({ ok: false, error: "Shop expired, please refresh shop" });
            }

            if (!Array.isArray(user.skillsBought)) user.skillsBought = [];
            if (user.skillsBought.some((sk) => sk.Id === skillId)) {
                return res.status(400).json({ ok: false, error: "Skill already bought" });
            }

            logShop("buySkill.begin", { userId, skillId, shopSeed: user.shopSeed });

            const skillsRng = mulberry32(hashSeed(`${user.shopSeed}:skills`));
            const usedSkillIds = new Set();
            let foundSkill = null;
            for (let i = 0; i < 6; i++) {
                const offer = generateSkillOffer(skillsRng, i, user.shopSeed, usedSkillIds);
                if (offer && offer.Id === skillId) {
                    foundSkill = offer;
                    break;
                }
            }

            if (!foundSkill) {
                return res.status(400).json({ ok: false, error: "Skill not found in current shop" });
            }

            const price = foundSkill.Price;
            if ((user.gold ?? 0) < price) {
                return res.status(400).json({
                    ok: false,
                    error: "Not enough gold",
                    requiredGold: price,
                    currentGold: user.gold ?? 0,
                });
            }

            user.gold -= price;
            user.skillsBought.push({
                ...foundSkill,
                InstanceId: crypto.randomUUID(),
                boughtAt: Date.now(),
                price,
            });

            await redis.set(userKey, JSON.stringify(user));

            logShop("buySkill.ok", { userId, skillId, price, goldLeft: user.gold });

            return res.json({
                ok: true,
                skill: foundSkill,
                price,
                goldLeft: user.gold,
            });
        } catch (err) {
            console.error("[Shop] BuySkill error:", err);
            return res.status(500).json({ ok: false, error: "Internal server error" });
        }
    });

    app.post("/shop/bought", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: "userId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const progressSynced = syncUserHeroesProgress(user);

            const heroesBought = Array.isArray(user.heroesBought)
                ? user.heroesBought
                : [];

            if (progressSynced.changed) {
                await redis.set(userKey, JSON.stringify(user));
            }

            return res.json({
                ok: true,
                count: heroesBought.length,
                leveledUpCount: progressSynced.leveledUpCount,
                statUpPoints: heroesBought.reduce(
                    (sum, hero) => sum + (Number.isFinite(hero.StatUpPoints) ? hero.StatUpPoints : 0),
                    0
                ),
                heroes: heroesBought
            });

        } catch (err) {
            console.error("[Shop] Bought error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/hero/equip", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId, instanceId } = req.body;

            if (!userId || !instanceId) {
                return res.status(400).json({
                    ok: false,
                    error: "userId and instanceId required"
                });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({
                    ok: false,
                    error: "User not found"
                });
            }

            const user = JSON.parse(rawUser);

            if (!Array.isArray(user.heroesBought)) {
                user.heroesBought = [];
            }

            if (!Array.isArray(user.equipmentHeroes)) {
                user.equipmentHeroes = [];
            }

            // =====================================================
            // 1️⃣ ЗАПРЕТ ЭКИПИРОВАТЬ ОДНОГО И ТОГО ЖЕ ГЕРОЯ ДВАЖДЫ
            // =====================================================
            const alreadyEquipped = user.equipmentHeroes.some(
                h => h.InstanceId === instanceId
            );

            if (alreadyEquipped) {
                return res.status(400).json({
                    ok: false,
                    error: "Hero already equipped"
                });
            }

            // =====================================================
            // 2️⃣ ОГРАНИЧЕНИЕ СЛОТОВ ЭКИПИРОВКИ (например, 3)
            // =====================================================
            const MAX_EQUIPPED = 6;

            if (user.equipmentHeroes.length >= MAX_EQUIPPED) {
                return res.status(400).json({
                    ok: false,
                    error: "No free equipment slots",
                    maxSlots: MAX_EQUIPPED
                });
            }

            // =====================================================
            // 🔍 ИЩЕМ ГЕРОЯ В heroesBought ПО InstanceId
            // =====================================================
            const heroIndex = user.heroesBought.findIndex(
                h => h.InstanceId === instanceId
            );

            if (heroIndex === -1) {
                return res.status(400).json({
                    ok: false,
                    error: "Hero with this InstanceId not found in heroesBought"
                });
            }

            // =====================================================
            // 🧲 ВЫНИМАЕМ ГЕРОЯ ИЗ КУПЛЕННЫХ
            // =====================================================
            const [equippedHero] = user.heroesBought.splice(heroIndex, 1);

            // =====================================================
            // ⚔️ КЛАДЁМ В ЭКИПИРОВАННЫЕ
            // =====================================================
            user.equipmentHeroes.push({
                ...equippedHero,
                equippedAt: Date.now()
            });

            await redis.set(userKey, JSON.stringify(user));

            return res.json({
                ok: true,
                message: "Hero equipped successfully",
                hero: equippedHero,
                equipmentHeroes: user.equipmentHeroes
            });

        } catch (err) {
            console.error("[Hero] Equip error:", err);
            return res.status(500).json({
                ok: false,
                error: "Internal server error"
            });
        }
    });
    
    app.post("/hero/equipment", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: "userId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const progressSynced = syncUserHeroesProgress(user);

            const equipmentHeroes = Array.isArray(user.equipmentHeroes)
                ? user.equipmentHeroes
                : [];

            if (progressSynced.changed) {
                await redis.set(userKey, JSON.stringify(user));
            }

            return res.json({
                ok: true,
                count: equipmentHeroes.length,
                leveledUpCount: progressSynced.leveledUpCount,
                equipmentHeroes: equipmentHeroes
            });

        } catch (err) {
            console.error("[Hero] Equipment list error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });


    app.post("/hero/unequip", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId, instanceId } = req.body;

            if (!userId || !instanceId) {
                return res.status(400).json({
                    ok: false,
                    error: "userId and instanceId required"
                });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({
                    ok: false,
                    error: "User not found"
                });
            }

            const user = JSON.parse(rawUser);

            if (!Array.isArray(user.heroesBought)) {
                user.heroesBought = [];
            }
            if (!Array.isArray(user.equipmentHeroes)) {
                user.equipmentHeroes = [];
            }

            const equipIndex = user.equipmentHeroes.findIndex(
                h => h.InstanceId === instanceId
            );

            if (equipIndex === -1) {
                return res.status(400).json({
                    ok: false,
                    error: "Hero with this InstanceId not found in equipmentHeroes"
                });
            }

            const [unequippedHero] = user.equipmentHeroes.splice(equipIndex, 1);

            // чтобы не копить служебное поле
            delete unequippedHero.equippedAt;

            user.heroesBought.push(unequippedHero);

            await redis.set(userKey, JSON.stringify(user));

            return res.json({
                ok: true,
                message: "Hero unequipped successfully",
                hero: unequippedHero,
                heroes: user.heroesBought,
                equipmentHeroes: user.equipmentHeroes
            });
        } catch (err) {
            console.error("[Hero] Unequip error:", err);
            return res.status(500).json({
                ok: false,
                error: "Internal server error"
            });
        }
    });

    app.post("/hero/xp", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId, instanceId, xp } = req.body;

            if (!userId || !instanceId || xp === undefined) {
                return res.status(400).json({
                    ok: false,
                    error: "userId, instanceId and xp required"
                });
            }

            const xpToAdd = Number(xp);
            if (!Number.isFinite(xpToAdd) || xpToAdd <= 0) {
                return res.status(400).json({
                    ok: false,
                    error: "xp must be a positive number"
                });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({
                    ok: false,
                    error: "User not found"
                });
            }

            const user = JSON.parse(rawUser);
            normalizeUserHeroes(user);

            if (!Array.isArray(user.heroesBought)) {
                user.heroesBought = [];
            }

            if (!Array.isArray(user.equipmentHeroes)) {
                user.equipmentHeroes = [];
            }

            let hero = user.heroesBought.find(h => h.InstanceId === instanceId);
            let location = "heroesBought";

            if (!hero) {
                hero = user.equipmentHeroes.find(h => h.InstanceId === instanceId);
                location = "equipmentHeroes";
            }

            if (!hero) {
                return res.status(404).json({
                    ok: false,
                    error: "Hero with this InstanceId not found"
                });
            }

            const progress = addHeroXp(hero, xpToAdd);

            await redis.set(userKey, JSON.stringify(user));

            return res.json({
                ok: true,
                location,
                hero,
                xpAdded: xpToAdd,
                leveledUp: progress.leveledUp,
                previousLevel: progress.previousLevel,
                currentLevel: hero.Lvl,
                currentXp: hero.Xp,
                statUpPoints: hero.StatUpPoints ?? 0,
                statPointsGained: Math.max(0, hero.Lvl - progress.previousLevel) * 5,
                nextLevelXpRequired: getHeroLevelUpXpRequired(hero.Lvl)
            });
        } catch (err) {
            console.error("[Hero] XP error:", err);
            return res.status(500).json({
                ok: false,
                error: "Internal server error"
            });
        }
    });

    app.post("/hero/statup", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const userId = req.body.userId ?? req.body.UserId;
            const instanceId = req.body.instanceId ?? req.body.InstanceId;

            if (!userId || !instanceId) {
                return res.status(400).json({
                    ok: false,
                    error: "UserId and InstanceId required"
                });
            }

            const requestedUpgrades = getRequestedHeroStatUpgrades(req.body);
            if (requestedUpgrades.error) {
                return res.status(400).json({
                    ok: false,
                    error: requestedUpgrades.error
                });
            }

            if (Object.keys(requestedUpgrades.stats).length === 0) {
                return res.status(400).json({
                    ok: false,
                    error: "At least one stat upgrade must be greater than 0"
                });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({
                    ok: false,
                    error: "User not found"
                });
            }

            const user = JSON.parse(rawUser);
            normalizeUserHeroes(user);

            if (!Array.isArray(user.heroesBought)) {
                user.heroesBought = [];
            }

            if (!Array.isArray(user.equipmentHeroes)) {
                user.equipmentHeroes = [];
            }

            let hero = user.heroesBought.find(h => h.InstanceId === instanceId);
            let location = "heroesBought";

            if (!hero) {
                hero = user.equipmentHeroes.find(h => h.InstanceId === instanceId);
                location = "equipmentHeroes";
            }

            if (!hero) {
                return res.status(404).json({
                    ok: false,
                    error: "Hero with this InstanceId not found"
                });
            }

            const upgradeResult = applyHeroAttributeUpgrades(hero, requestedUpgrades.stats);

            if (!upgradeResult.ok) {
                return res.status(400).json({
                    ok: false,
                    error: upgradeResult.error,
                    details: upgradeResult.details
                });
            }

            await redis.set(userKey, JSON.stringify(user));

            return res.json({
                ok: true,
                location,
                hero,
                spentStatUpPoints: upgradeResult.spentStatUpPoints,
                statUpPointsLeft: hero.StatUpPoints ?? 0,
                appliedUpgrades: upgradeResult.appliedUpgrades
            });
        } catch (err) {
            console.error("[Hero] StatUp error:", err);
            return res.status(500).json({
                ok: false,
                error: "Internal server error"
            });
        }
    });

    app.post("/hero/character", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: "userId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);
            const progressSynced = syncUserHeroesProgress(user);

            const heroesBought = Array.isArray(user.heroesBought)
                ? user.heroesBought
                : [];

            if (progressSynced.changed) {
                await redis.set(userKey, JSON.stringify(user));
            }

            return res.json({
                ok: true,
                count: heroesBought.length,
                leveledUpCount: progressSynced.leveledUpCount,
                statUpPoints: heroesBought.reduce(
                    (sum, hero) => sum + (Number.isFinite(hero.StatUpPoints) ? hero.StatUpPoints : 0),
                    0
                ),
                heroes: heroesBought
            });
        } catch (err) {
            console.error("[Hero] Character error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/user/resources", async (req, res) => {
        try {
            const redis = await requireRedis(res);
            if (!redis) {
                return;
            }

            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({ error: "userId required" });
            }

            const userKey = `user:${userId}`;
            const rawUser = await redis.get(userKey);

            if (!rawUser) {
                return res.status(404).json({ error: "User not found" });
            }

            const user = JSON.parse(rawUser);

            return res.json({
                ok: true,
                userId,
                gold: user.gold ?? 0,
                rating: user.rating ?? 0
            });
        } catch (err) {
            console.error("[User] Resources error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.listen(PORT, HOST, () => {
        console.log(`🚀 Server started on http://${HOST}:${PORT}`);
    });

    getRedis().catch((err) => {
        console.error("[Redis] Initial connection failed:", err);
    });

    function calculateHeroPrice(hero) {
        let price = 50;
        
        price += hero.HpMax * 0.15;
        price += hero.DefenceP * 0.6;
        price += hero.DefenceM * 0.6;
        
        price += hero.DamageP * 1.2;
        price += hero.DamageM * 1.2;
        
        price += hero.AttackRange * 15;
        price += hero.Initiative * 0.5;
        
        price += hero.MaxAP * 20;
        price += (2 - hero.MoveCost) * 10;
        
        const attrs = hero.Attributes || {};
        price += (Number(attrs.Strength) || 0) * 10;
        price += (Number(attrs.Dexterity) || 0) * 10;
        price += (Number(attrs.Constitution) || 0) * 10;
        price += (Number(attrs.Intelligence) || 0) * 10;
        price += (Number(attrs.Wisdom) || 0) * 10;

        return Math.floor(price);
    }
    
    function generateShop(userId) {
        const seed = hashSeed(userId + Date.now());
        const rng = mulberry32(seed);

        const heroes = [];
        for (let i = 0; i < 6; i++) {
            heroes.push(generateHero(rng, i, seed));
        }

        return { seed, heroes };
    }

    function randIntInclusive(rng, min, max) {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    function pickOne(rng, arr) {
        return arr[Math.floor(rng() * arr.length)];
    }

    function generateItemName(rng) {
        const base = pickOne(rng, ["Меч", "Лук", "Арбалет", "Кинжал", "Посох", "Топор", "Копьё"]);
        const suffix = pickOne(rng, [
            "Эрадина",
            "бездны",
            "царей",
            "демона",
            "пепла",
            "клятвы",
            "теней",
            "дракона",
            "льда",
        ]);
        return `${base} ${suffix}`;
    }

    function generateItem(itemsRng, index, shopSeed) {
        const itemId = hashSeed(`${shopSeed}:item:${index}`);

        const statsCount = randIntInclusive(itemsRng, 0, 5);
        const available = [...HERO_ATTRIBUTE_KEYS];
        const stats = [];

        for (let i = 0; i < statsCount && available.length > 0; i++) {
            const keyIndex = Math.floor(itemsRng() * available.length);
            const key = available.splice(keyIndex, 1)[0];
            const value = randIntInclusive(itemsRng, -5, 15);
            stats.push({ Key: key, Value: value });
        }

        const effectRoll = itemsRng();
        const effect = effectRoll < 0.3 ? pickOne(itemsRng, EFFECTS_CATALOG) : null;

        const skillRoll = itemsRng();
        const skill = skillRoll < 0.2 ? pickOne(itemsRng, SKILLS_CATALOG) : null;

        const item = {
            Id: itemId,
            Name: generateItemName(itemsRng),
            Stats: stats,
            UniqueEffect: effect
                ? {
                    Id: effect.Id,
                    Name: effect.Name,
                    Modifiers: effect.Modifiers,
                    Description: effect.Description,
                    Cost: effect.Cost,
                }
                : null,
            Skill: skill
                ? {
                    Id: skill.Id,
                    Name: skill.Name,
                    CooldownTurns: skill.CooldownTurns,
                    Payload: skill.Payload,
                    Description: skill.Description,
                    Cost: skill.Cost,
                }
                : null,
        };

        item.Price = calculateItemPrice(item);
        return item;
    }

    function calculateItemPrice(item) {
        let price = 100;

        for (const st of item.Stats || []) {
            const v = Number(st.Value) || 0;
            if (v > 0) price += v * 25;
            if (v < 0) price -= Math.abs(v) * 10;
        }

        if (item.UniqueEffect?.Cost) price += Number(item.UniqueEffect.Cost) || 0;
        if (item.Skill?.Cost) price += Number(item.Skill.Cost) || 0;

        price = Math.floor(price);
        return Math.max(20, price);
    }

    function generateSkillOffer(skillsRng, index, shopSeed, usedSkillIds) {
        if (!Array.isArray(SKILLS_CATALOG) || SKILLS_CATALOG.length === 0) return null;

        for (let attempts = 0; attempts < 10; attempts++) {
            const skill = pickOne(skillsRng, SKILLS_CATALOG);
            if (usedSkillIds?.has(skill.Id)) continue;
            if (usedSkillIds) usedSkillIds.add(skill.Id);

            return {
                Id: skill.Id,
                Name: skill.Name,
                CooldownTurns: skill.CooldownTurns,
                Payload: skill.Payload,
                Description: skill.Description,
                Price: skill.Cost,
                OfferId: hashSeed(`${shopSeed}:skillOffer:${index}:${skill.Id}`),
            };
        }

        return null;
    }

    function generateHero(rng, index, shopSeed) {
        const defaults = cloneHeroDefaults();
        const heroId = hashSeed(`${shopSeed}:${index}`);
        const races = ["human", "elf", "orc"];
        const race = races[Math.floor(rng() * races.length)];
        const name = generateName(rng, race);
        const hero = {
            Id: heroId,
            Name: name,

            Gender: Math.floor(rng() * 2),
            DeathCharges: defaults.DeathCharges,
            Lvl: defaults.Lvl,
            Xp: defaults.Xp,
            StatUpPoints: defaults.StatUpPoints,
            Initiative: defaults.Initiative,

            HpMax: defaults.HpMax,
            DefenceP: defaults.DefenceP,
            DefenceM: defaults.DefenceM,
            
            DamageP: defaults.DamageP,
            DamageM: defaults.DamageM,
            
            AttackRange: Math.floor(rng() * 10) + 1,
            MoveCost: defaults.MoveCost,
            MaxAP: defaults.MaxAP,
            
            Attributes: rollAttributes(rng),
            
            Skills: [],
            EquipmentSlots: {
                Weapon: {
                    LeftHand: null,
                    RightHand: null
                },
                Armor:{
                    Head: null,
                    Body: null,
                    Legs: null
                }
            }
        };

        // Derived stats from attributes overwrite base fields
        recomputeDerivedStatsFromAttributes(hero);
        return hero;
    }

    function getRequestedHeroStatUpgrades(body) {
        // backward-compatible wrapper name used by endpoint
        return getRequestedHeroAttributeUpgrades(body);
    }

    function mulberry32(a) {
        return function () {
            let t = a += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hashSeed(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }
    
    function generateName(rng, race) {
        const patterns = namePatterns[race];

        const pick = (arr) => arr[Math.floor(rng() * arr.length)];

        const prefix = pick(patterns.prefix);
        const root = pick(patterns.root);
        const suffix = pick(patterns.suffix);

        const name = prefix + root + suffix;

        return name.charAt(0).toUpperCase() + name.slice(1);
    }
}


start().catch((error) => {
    console.error("[Startup] Failed to start server:", error);
    process.exit(1);
});
