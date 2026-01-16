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

        if (user.lastShopUpdate && now - user.lastShopUpdate < UPDATE_INTERVAL) {
            return res.json({
                ok: true,
                fromCache: true,
                shopSeed: user.shopSeed,
                heroes: user.shopItems
            });
        }

        const shop = generateShop(userId);

        user.lastShopUpdate = now;
        user.shopSeed = shop.seed;
        user.shopItems = shop.heroes;

        await redis.set(userKey, JSON.stringify(user));

        res.json({
            ok: true,
            fromCache: false,
            shopSeed: shop.seed,
            heroes: shop.heroes
        });
    });
    
    app.listen(3000, () => {
        console.log("🚀 Server started on http://localhost:3000");
    });
    
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
