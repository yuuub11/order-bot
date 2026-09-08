import { Bot } from "grammy";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SHOP_PROMPT = `
Ти продавець магазина 'Мой Магазин'.
Спілкуйся українською, дружньо, на 'ти', коротко.
ЦІЛЬ: прийняти замовлення. Збери:
1. Товар і кількість
2. ПІБ клієнта
3. Телефон
4. Місто + відділення Нової Пошти
`;

// Обробка прямих текстових повідомлень від користувачів боту
bot.on("message:text", async (ctx) => {
  try {
    const userMessage = ctx.message.text;

    // Запит до Gemini API
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userMessage,
      config: { systemInstruction: SHOP_PROMPT },
    });

    if (response.text) {
      await ctx.reply(response.text);
    }
  } catch (error) {
    console.error("Помилка при обробці повідомлення:", error);
  }
});

// Глобальний обробник помилок (щоб бот не вимикався при збоях)
bot.catch((err) => {
  console.error("Помилка в роботі бота:", err.error);
});

// Запуск HTTP-сервера для Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`HTTP-сервер запущено на порту ${PORT}`);
});

bot.start();
