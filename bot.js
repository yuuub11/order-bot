import { Bot } from "grammy";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import http from "http"; // Встроенный модуль Node.js

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

bot.on("business_message", async (ctx) => {
  if (ctx.from.id === ctx.businessConnection.user.id) return;

  const userMessage = ctx.businessMessage.text;
  if (!userMessage) return;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userMessage,
      config: { systemInstruction: SHOP_PROMPT },
    });

    if (response.text) {
      await ctx.reply(response.text);
    }
  } catch (error) {
    console.error("Помилка Gemini API:", error);
  }
});

// Запуск простейшего HTTP-сервера для Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`HTTP-сервер запущен на порту ${PORT}`);
});

bot.start();
