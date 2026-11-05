
import express from "express";
import { Bot } from "grammy";
import crypto from "node:crypto";
import admin from "firebase-admin";
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Bot(BOT_TOKEN);
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();


async function createNumber(telegramId) {
  while (true) {
    const number = "+7" + "9" + crypto.randomInt(100000000, 1000000000);

    const result = await db.ref("numberToTelegramId/" + number)
      .transaction(current => {
        return current === null ? telegramId : undefined;
      });

    if (result.committed) {
      await db.ref("users/" + telegramId).set({
        number: number,
        createdAt: Date.now()
      });

      return number;
    }
  }
}
// Регистрация через Telegram-бота
bot.command("start", async (ctx) => {
  const telegramId = String(ctx.from.id);

  const userRef = db.ref("users/" + telegramId);
  const snapshot = await userRef.get();

  let user = snapshot.val();

  if (!user || !user.number) {
    const number = await createNumber(telegramId);
    user = { number };
  }

  await ctx.reply(
    `Добро пожаловать в StarGram!\n\nТвой номер: ${user.number}\n\nСохрани его для входа в StarGram.`
  );
});

// Запрос кода входа
app.post("/request-code", async (req, res) => {
  const { number } = req.body;
  console.log("Получен номер:", number);
  

  if (typeof number !== "string") {
    return res.status(400).json({ error: "Введите номер StarGram" });
  }
  const numberKey = number.replace(/\+/g, "");

const snapshot = await db.ref("numberToTelegramId/" + numberKey).get();
  const telegramId = snapshot.val();

  if (!telegramId) {
    return res.status(404).json({ error: "Аккаунт не найден" });
  }

  const cooldownRef = db.ref("requestLimits/" + number);
  const cooldownSnapshot = await cooldownRef.get();
  const nextAllowedAt = cooldownSnapshot.val();

  if (nextAllowedAt && Date.now() < nextAllowedAt) {
    return res.status(429).json({ error: "Подождите перед повторным запросом" });
  }

  const code = String(crypto.randomInt(10000, 100000));

  await db.ref("loginCodes/" + number).set({
    codeHash: crypto.createHash("sha256").update(code).digest("hex"),
    expiresAt: Date.now() + 5 * 60 * 1000,
    attempts: 0
  });

  await cooldownRef.set(Date.now() + 60 * 1000);

  try {
    await bot.api.sendMessage(
      telegramId,
      `Код входа в StarGram: ${code}\n\nОн действует 5 минут. Никому его не сообщай.`
    );

    res.json({ success: true, message: "Код отправлен" });
  } catch {
    await db.ref("loginCodes/" + number).remove();
    res.status(500).json({ error: "Не удалось отправить код" });
  }
});
});

// Проверка кода
app.post("/verify-code", async (req, res) => {
  const { number, code } = req.body;

  if (typeof number !== "string" || typeof code !== "string") {
    return res.status(400).json({ error: "Введите номер и код" });
  }

  const codeRef = db.ref("loginCodes/" + number);
  const snapshot = await codeRef.get();
  const saved = snapshot.val();

  if (!saved || saved.expiresAt < Date.now()) {
    await codeRef.remove();
    return res.status(401).json({ error: "Код истёк или не найден" });
  }

  if (saved.attempts >= 5) {
    await codeRef.remove();
    return res.status(429).json({ error: "Слишком много попыток" });
  }

  const inputHash = crypto.createHash("sha256")
    .update(code)
    .digest("hex");

  if (saved.codeHash !== inputHash) {
    await codeRef.child("attempts").transaction(value => (value || 0) + 1);
    return res.status(401).json({ error: "Неверный код" });
  }

  const userSnapshot = await db.ref("numberToTelegramId/" + number).get();
const telegramId = userSnapshot.val();

if (!telegramId) {
  return res.status(404).json({ error: "Аккаунт не найден" });
}

const sessionToken = crypto.randomBytes(32).toString("hex");

const tokenHash = crypto.createHash("sha256")
  .update(sessionToken)
  .digest("hex");

const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

await db.ref("sessions/" + tokenHash).set({
  telegramId,
  number,
  createdAt: Date.now(),
  expiresAt
});

await codeRef.remove();

res.json({
  success: true,
  sessionToken,
  expiresAt
});


// Проверка сервера
app.get("/", (req, res) => {
  res.send("StarGram server is running!");
});

bot.start();

app.listen(PORT, () => {
  console.log("StarGram server started!");
});
