import { Bot } from "grammy";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Инициализация бота и Gemini
const bot = new Bot(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Промпт для магазина
const SHOP_PROMPT = `
Ти продавець магазина 'Мой Магазин'.
Спілкуйся українською, дружньо, на 'ти', коротко.
ЦІЛЬ: прийняти замовлення. Збери:
1. Товар і кількість
2. ПІБ клієнта
3. Телефон
4. Місто + відділення Нової Пошти

КАТАЛОГ:
Nike Air Force White (розмір 40) — 1900 грн
Jordan 1 Retro Blue (розмір 41) — 1700 грн

УМОВИ: Нова Пошта, накладений платіж.
Коли зібрав всі дані — підсумуй і напиши 'Замовлення прийнято'.
Будь лаконічним: 1-3 речення на повідомлення.
`;

// Обработка входящих сообщений в Telegram Business
bot.on("business_message", async (ctx) => {
  // Игнорируем сообщения, отправленные владельцем аккаунта
  if (ctx.from.id === ctx.businessConnection.user.id) return;

  const userMessage = ctx.businessMessage.text;
  if (!userMessage) return;

  try {
    // Запрос к бесплатной модели Gemini 2.5 Flash
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userMessage,
      config: {
        systemInstruction: SHOP_PROMPT,
      },
    });

    if (response.text) {
      await ctx.reply(response.text);
    }
  } catch (error) {
    console.error("Ошибка при запросе к Gemini:", error);
  }
});

bot.start();