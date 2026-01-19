const express = require("express");
const { createClient } = require("redis");

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

            const heroes = [];
            for (let i = 0; i < 6; i++) {
                heroes.push(generateHero(rng, i));
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
            const { userId, heroIndex } = req.body;

            if (!userId || heroIndex === undefined) {
                return res.status(400).json({ error: "userId and heroIndex required" });
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

            // 🔁 Восстанавливаем магазин по сидy
            const rng = mulberry32(user.shopSeed);

            const heroes = [];
            for (let i = 0; i < 6; i++) {
                heroes.push(generateHero(rng, i));
            }

            const hero = heroes[heroIndex];

            if (!hero) {
                return res.status(400).json({ error: "Invalid heroIndex" });
            }

            // 💰 Цена героя (можешь поменять формулу)
            const price = calculateHeroPrice(hero);

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
                ...hero,
                boughtAt: Date.now(),
                price
            });

            // 🧹 (опционально) сброс магазина после покупки
            // user.shopSeed = null;
            // user.lastShopUpdate = null;

            await redis.set(userKey, JSON.stringify(user));

            return res.json({
                ok: true,
                hero,
                price,
                goldLeft: user.gold
            });

        } catch (err) {
            console.error("[Shop] Buy error:", err);
            return res.status(500).json({ error: "Internal server error" });
        }
    });



    
    app.listen(3000, () => {
        console.log("🚀 Server started on http://localhost:3000");
    });

    function calculateHeroPrice(hero) {
        let price = 50;

        price += hero.Hp * 0.2;
        price += hero.DamageP * 1.5;
        price += hero.DamageM * 1.5;
        price += hero.DefenceP * 0.5;
        price += hero.DefenceM * 0.5;
        price += hero.Speed * 0.3;
        price += hero.AttackSpeed * 0.4;

        return Math.floor(price);
    }
    
    function generateShop(userId) {
        const seed = hashSeed(userId + Date.now());
        const rng = mulberry32(seed);

        const heroes = [];
        for (let i = 0; i < 6; i++) {
            heroes.push(generateHero(rng, i));
        }

        return { seed, heroes };
    }

    function generateHero(rng, index) {
        return {
            Name: `Hero_${index}`,
            TypeClass: Math.floor(rng() * 4),
            Hp: Math.floor(80 + rng() * 70),
            DamageP: Math.floor(10 + rng() * 20),
            DamageM: Math.floor(10 + rng() * 20),
            DefenceP: Math.floor(rng() * 40),
            DefenceM: Math.floor(rng() * 40),
            Speed: Math.floor(50 + rng() * 50),
            AttackSpeed: Math.floor(10 + rng() * 30),
            Lvl: 1,
            Xp: 0
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
}

start();
