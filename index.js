import express from "express";
import { Bot } from "grammy";
import crypto from "node:crypto";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is missing");
}

const bot = new Bot(BOT_TOKEN);

const users = new Map();
const codes = new Map();
const cooldowns = new Map();

function createNumber() {
  let number;

  do {
    number = "SG" + crypto.randomInt(10000, 100000);
  } while (
    [...users.values()].some(user => user.number === number)
  );

  return number;
}

// Регистрация через Telegram-бота
bot.command("start", async (ctx) => {
  const telegramId = String(ctx.from.id);

  let user = users.get(telegramId);

  if (!user) {
    user = {
      number: createNumber()
    };

    users.set(telegramId, user);
  }

  await ctx.reply(
    `Добро пожаловать в StarGram!\n\nТвой номер: ${user.number}\n\nСохрани его для входа в StarGram.`
  );
});

// Запрос кода входа
app.post("/request-code", async (req, res) => {
  const { number } = req.body;

  if (typeof number !== "string") {
    return res.status(400).json({
      error: "Введите номер StarGram"
    });
  }

  const entry = [...users.entries()].find(
    ([, user]) => user.number === number
  );

  if (!entry) {
    return res.status(404).json({
      error: "Аккаунт не найден"
    });
  }

  const [telegramId] = entry;

  if (
    cooldowns.has(number) &&
    Date.now() < cooldowns.get(number)
  ) {
    return res.status(429).json({
      error: "Подождите перед повторным запросом"
    });
  }

  const code = String(
    crypto.randomInt(10000, 100000)
  );

  codes.set(number, {
    code,
    expires: Date.now() + 5 * 60 * 1000,
    attempts: 0
  });

  cooldowns.set(number, Date.now() + 60 * 1000);

  try {
    await bot.api.sendMessage(
      telegramId,
      `Код входа в StarGram: ${code}\n\nОн действует 5 минут. Никому его не сообщай.`
    );

    res.json({
      success: true,
      message: "Код отправлен"
    });
  } catch {
    codes.delete(number);

    res.status(500).json({
      error: "Не удалось отправить код"
    });
  }
});

// Проверка кода
app.post("/verify-code", (req, res) => {
  const { number, code } = req.body;
  const saved = codes.get(number);

  if (!saved || saved.expires < Date.now()) {
    codes.delete(number);

    return res.status(401).json({
      error: "Код истёк или не найден"
    });
  }

  saved.attempts++;

  if (saved.attempts > 5) {
    codes.delete(number);

    return res.status(429).json({
      error: "Слишком много попыток"
    });
  }

  if (saved.code !== String(code)) {
    return res.status(401).json({
      error: "Неверный код"
    });
  }

  codes.delete(number);

  res.json({
    success: true,
    message: "Код подтверждён"
  });
});

// Проверка сервера
app.get("/", (req, res) => {
  res.send("StarGram server is running!");
});

bot.start();

app.listen(PORT, () => {
  console.log("StarGram server started!");
});
