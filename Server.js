const express = require("express");
const { createClient } = require("redis");
const namePatterns = require("./namePatterns.json");

async function start() {
    const redis = createClient({
        socket: {
            host: "redis-17419.c328.europe-west3-1.gce.cloud.redislabs.com",
            port: 17419,
        },
        password: "af0gO9r23iS9w7sYd8T0XtQktQR0ZXnl",
    });

    redis.on("error", (err) => console.error("Redis error:", err));
    await redis.connect();

    console.log("✅ Redis connected");

    const app = express();
    app.use(express.json());

    app.post("/shop/update", async (req, res) => {
        try {
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



            const shopResponse = {
                ok: true,
                fromCache,
                shopSeed,
                heroes
            };

            return res.json(shopResponse);

        } catch (err) {
            console.error("[Shop] Internal error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/shop/buy", async (req, res) => {
        try {
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

            if (!user.shopSeed) {
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
                InstanceId: crypto.randomUUID(),
                boughtAt: Date.now(),
                price
            });

            await redis.set(userKey, JSON.stringify(user));

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

    app.post("/shop/bought", async (req, res) => {
        try {
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

            const heroesBought = Array.isArray(user.heroesBought)
                ? user.heroesBought
                : [];

            return res.json({
                ok: true,
                count: heroesBought.length,
                heroes: heroesBought
            });

        } catch (err) {
            console.error("[Shop] Bought error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    app.post("/hero/equip", async (req, res) => {
        try {
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

            const equipmentHeroes = Array.isArray(user.equipmentHeroes)
                ? user.equipmentHeroes
                : [];

            return res.json({
                ok: true,
                count: equipmentHeroes.length,
                equipmentHeroes: equipmentHeroes
            });

        } catch (err) {
            console.error("[Hero] Equipment list error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });


    app.post("/hero/unequip", async (req, res) => {
        try {
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

    app.post("/user/resources", async (req, res) => {
        try {
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



    app.listen(3000, () => {
        console.log("🚀 Server started on http://localhost:3000");
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

    function generateHero(rng, index, shopSeed) {
        const heroId = hashSeed(`${shopSeed}:${index}`);
        const races = ["human", "elf", "orc"];
        const race = races[Math.floor(rng() * races.length)];
        const name = generateName(rng, race);
        return {
            Id: heroId,
            Name: name,

            Gender: Math.floor(rng() * 2),
            DeathCharges: 3,
            Lvl: 1,
            Xp: 0,
            Initiative: Math.floor(40 + rng() * 60),

            HpMax: Math.floor(8 + rng() * 7),
            DefenceP: Math.floor(rng() * 40),
            DefenceM: Math.floor(rng() * 40),
            
            DamageP: Math.floor(10 + rng() * 20),
            DamageM: Math.floor(10 + rng() * 20),
            
            AttackRange: Math.floor(rng() * 10) + 1,
            MoveCost: Math.floor(rng() * 3) + 1,
            MaxAP: 6,
            
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


start();
