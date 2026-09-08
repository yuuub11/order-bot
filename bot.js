import { Bot } from "grammy";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SHOP_PROMPT = `
Ти продавець магазина 'Мой Магазин'.
Спілкуйся українською, дружньо, на 'ти', дуже коротко (1-2 речення).
ЦІЛЬ: прийняти замовлення. Збери:
1. Товар і кількість
2. ПІБ клієнта
3. Телефон
4. Місто + відділення Нової Пошти
`;

bot.on("message:text", async (ctx) => {
  try {
    // 1. Відправляємо статус "друкує...", щоб користувач бачив активність
    await ctx.replyWithChatAction("typing");

    const userMessage = ctx.message.text;

    // 2. Обмеження maxOutputTokens прискорює генерацію в 2-3 рази
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: userMessage,
      config: { 
        systemInstruction: SHOP_PROMPT,
        maxOutputTokens: 150 
      },
    });

    if (response.text) {
      await ctx.reply(response.text);
    }
  } catch (error) {
    console.error("Помилка при обробці повідомлення:", error);
  }
});

bot.catch((err) => {
  console.error("Помилка в роботі бота:", err.error);
});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running!");
}).listen(PORT, () => {
  console.log(`HTTP-сервер запущено на порту ${PORT}`);
});

bot.start();
