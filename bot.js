// bot.js — Розумний бот з адмін-панеллю, підтримкою живих фото та пам'яттю
import { Bot, InputFile } from "grammy";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import http from "http";
import fs from "fs";
import path from "path";
import { SHOP_PROMPT, generateShopPrompt } from "./prompt.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ID власника в Telegram (можна дізнатися через бота @userinfobot)
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

if (!BOT_TOKEN || !GEMINI_API_KEY) {
  console.error("Помилка: перевірте наявність BOT_TOKEN та GEMINI_API_KEY у змінних оточення!");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ==========================================
// КЕРУВАННЯ БАЗОЮ ТОВАРІВ (catalog.json)
// ==========================================
const CATALOG_PATH = path.resolve("./catalog.json");

function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      const data = fs.readFileSync(CATALOG_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Помилка читання catalog.json:", err);
  }
  return [];
}

function saveCatalog(catalog) {
  try {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), "utf-8");
  } catch (err) {
    console.error("Помилка запису в catalog.json:", err);
  }
}

let catalog = loadCatalog();

// Стан адміна (для очікування фотографій або команд)
const adminStates = new Map();

// ==========================================
// ПАМ'ЯТЬ ДІАЛОГІВ КЛІЄНТІВ
// ==========================================
const chatHistories = new Map();
function getChatHistory(chatId) {
  if (!chatHistories.has(chatId)) {
    chatHistories.set(chatId, []);
  }
  return chatHistories.get(chatId);
}

// Захист від дублювання оновлень Telegram
const processedUpdates = new Set();
function isDuplicate(ctx) {
  const key = `${ctx.chat?.id}:${ctx.message?.message_id}`;
  if (processedUpdates.has(key)) return true;
  processedUpdates.add(key);
  setTimeout(() => processedUpdates.delete(key), 2 * 60 * 1000);
  return false;
}

// Перевірка, чи є користувач адміном
function isAdmin(ctx) {
  return ADMIN_ID && ctx.from?.id === ADMIN_ID;
}

// ==========================================
// АДМІН-ПАНЕЛЬ ВЛАСНИКА МАГАЗИНУ
// ==========================================

// Команда /admin — список товарів та команди керування
bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return;

  let message = `👑 **ПАНЕЛЬ ВЛАСНИКА МАГАЗИНУ**\n\n`;
  message += `**Товари в системі:**\n`;

  catalog.forEach((item, index) => {
    const liveCount = item.ownerPhotos?.length || 0;
    const offCount = item.officialPhotos?.length || 0;
    const status = item.inStock ? "🟢 В наявності" : "🔴 Немає";
    message += `${index + 1}. **${item.name}** (ID: \`${item.id}\`)\n`;
    message += `   Ціна: ${item.price} грн | Розміри: ${item.sizes.join(", ") || "—"}\n`;
    message += `   Статус: ${status} | Фото: 📸 живих: ${liveCount}, 🌐 офіц: ${offCount}\n\n`;
  });

  message += `🛠 **Команди швидкого налаштування:**\n`;
  message += `• \`/upload <id>\` — увімкнути завантаження живих фото товару\n`;
  message += `• \`/addurl <id> <посилання_на_фото>\` — додати офіційне фото\n`;
  message += `• \`/stock <id> 40,41,42\` — оновити доступні розміри\n`;
  message += `• \`/price <id> 2500\` — змінити ціну\n`;
  message += `• \`/toggle <id>\` — змінити статус (в наявності / немає)\n`;
  message += `• \`/clearphotos <id>\` — видалити всі завантажені фото товару\n`;

  await ctx.reply(message, { parse_mode: "Markdown" });
});

// Команда /upload <id> — вмикає режим приймання фото
bot.command("upload", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const targetId = ctx.match.trim();
  const product = catalog.find((p) => p.id === targetId);

  if (!product) {
    return await ctx.reply(`❌ Товар з ID "${targetId}" не знайдено! Перегляньте список через /admin`);
  }

  adminStates.set(ctx.from.id, { action: "WAITING_PHOTOS", productId: targetId });
  await ctx.reply(
    `📸 **Режим завантаження фото активовано для товару:**\n` +
    `👉 **${product.name}**\n\n` +
    `Надішліть зараз одне або кілька фото у цей чат.\n` +
    `Коли закінчите, надішліть команду /done.`,
    { parse_mode: "Markdown" }
  );
});

// Завершення завантаження фото
bot.command("done", async (ctx) => {
  if (!isAdmin(ctx)) return;
  adminStates.delete(ctx.from.id);
  await ctx.reply("✅ Завантаження фото завершено! Каталог оновлено.");
});

// Команда /addurl <id> <url> — додати офіційне фото через посилання
bot.command("addurl", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const parts = ctx.match.trim().split(" ");
  if (parts.length < 2) {
    return await ctx.reply("Формат: `/addurl <id_товару> <посилання_на_фото>`", { parse_mode: "Markdown" });
  }

  const [id, url] = parts;
  const product = catalog.find((p) => p.id === id);
  if (!product) return await ctx.reply("Товар не знайдено!");

  if (!product.officialPhotos) product.officialPhotos = [];
  product.officialPhotos.push(url);
  saveCatalog(catalog);

  await ctx.reply(`✅ Офіційне фото додано до товару **${product.name}**!`);
});

// Зміна розмірів: /stock air_force_1 40,41,42,43
bot.command("stock", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const [id, sizesStr] = ctx.match.trim().split(" ");
  const product = catalog.find((p) => p.id === id);
  if (!product) return await ctx.reply("Товар не знайдено!");

  product.sizes = sizesStr ? sizesStr.split(",").map((s) => s.trim()) : [];
  saveCatalog(catalog);
  await ctx.reply(`✅ Розміри для **${product.name}** оновлено: ${product.sizes.join(", ") || "немає в наявності"}`);
});

// Зміна ціни: /price air_force_1 2300
bot.command("price", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const [id, priceStr] = ctx.match.trim().split(" ");
  const product = catalog.find((p) => p.id === id);
  if (!product || !priceStr) return await ctx.reply("Формат: `/price <id> <нова_ціна>`");

  product.price = Number(priceStr);
  saveCatalog(catalog);
  await ctx.reply(`✅ Ціну для **${product.name}** змінено на ${product.price} грн!`);
});

// Перемикач наявності: /toggle air_force_1
bot.command("toggle", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = ctx.match.trim();
  const product = catalog.find((p) => p.id === id);
  if (!product) return await ctx.reply("Товар не знайдено!");

  product.inStock = !product.inStock;
  saveCatalog(catalog);
  await ctx.reply(`✅ Статус товару **${product.name}**: ${product.inStock ? "В НАЯВНОСТІ 🟢" : "НЕМАЄ В НАЯВНОСТІ 🔴"}`);
});

// Очищення фото товару
bot.command("clearphotos", async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = ctx.match.trim();
  const product = catalog.find((p) => p.id === id);
  if (!product) return await ctx.reply("Товар не знайдено!");

  product.ownerPhotos = [];
  saveCatalog(catalog);
  await ctx.reply(`🗑 Усі завантажені живі фото для **${product.name}** видалено!`);
});

// Обробка фотографій, надісланих власником
bot.on("message:photo", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const state = adminStates.get(ctx.from.id);
  if (state && state.action === "WAITING_PHOTOS") {
    const product = catalog.find((p) => p.id === state.productId);
    if (product) {
      // Отримуємо найкращу якість надісланого фото
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      if (!product.ownerPhotos) product.ownerPhotos = [];
      product.ownerPhotos.push(photo.file_id);
      saveCatalog(catalog);

      await ctx.reply(`📸 Фото додано до **${product.name}**! (Всього живих фото: ${product.ownerPhotos.length})\nНадішліть ще фото або напишіть /done`);
    }
  }
});

// ==========================================
// КЛІЄНТСЬКІ КОМАНДИ ТА ДІАЛОГИ
// ==========================================

bot.command("start", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  await ctx.reply(
    `Привіт! 👋 Вітаємо в онлайн-магазині **StreetDrop**! 👟🔥\n\n` +
    `Я допоможу підібрати ідеальну пару взуття, покажу живі фото зі складу та швидко оформлю замовлення.\n\n` +
    `📌 /catalog — подивитися всі моделі в наявності\n` +
    `📌 /clear — скинути діалог\n\n` +
    `Яка модель чи розмір тебе цікавить? Напиши мені! 👇`,
    { parse_mode: "Markdown" }
  );
});

bot.command("catalog", async (ctx) => {
  let text = `🔥 **АКТУАЛЬНИЙ КАТАЛОГ МАГАЗИНУ:**\n\n`;
  catalog.forEach((item) => {
    if (item.inStock) {
      text += `👟 **${item.name}**\n`;
      text += `• Розміри: ${item.sizes.join(", ")}\n`;
      text += `• Ціна: **${item.price} грн**\n\n`;
    }
  });
  text += `Напиши, яку пару показати ближче, і я скину фото! 📸`;
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("clear", async (ctx) => {
  chatHistories.delete(ctx.chat.id);
  await ctx.reply("Діалог очищено! 🔄 Чим можу допомогти?");
});

// ==========================================
// ФУНКЦІЯ НАДСИЛАННЯ ФОТО З ПРІОРИТЕТОМ
// ==========================================
async function sendProductImages(ctx, productId, count = 2, isMore = false) {
  const product = catalog.find((p) => p.id === productId);
  if (!product) return;

  // Пріоритет: спочатку живі фото від власника, потім офіційні
  const ownerPhotos = product.ownerPhotos || [];
  const officialPhotos = product.officialPhotos || [];

  let selectedPhotos = [];

  if (!isMore) {
    // Перша видача: беремо до 2 фото (пріоритет — фото власника)
    if (ownerPhotos.length > 0) {
      selectedPhotos = ownerPhotos.slice(0, count).map((fileId) => ({ type: "photo", media: fileId }));
    }
    // Якщо живих фото менше ніж потрібно — добираємо з офіційних
    if (selectedPhotos.length < count && officialPhotos.length > 0) {
      const needed = count - selectedPhotos.length;
      const officialToAdd = officialPhotos.slice(0, needed).map((url) => ({ type: "photo", media: url }));
      selectedPhotos = selectedPhotos.concat(officialToAdd);
    }
  } else {
    // Видача "Більше фото": показуємо решту живих фото, а потім решту офіційних
    const remainingOwner = ownerPhotos.slice(2).map((fileId) => ({ type: "photo", media: fileId }));
    const remainingOfficial = officialPhotos.slice(1).map((url) => ({ type: "photo", media: url }));
    selectedPhotos = [...remainingOwner, ...remainingOfficial];

    // Якщо раптом додаткових нема, показуємо всі наявні живі ще раз для детального огляду
    if (selectedPhotos.length === 0 && ownerPhotos.length > 0) {
      selectedPhotos = ownerPhotos.map((fileId) => ({ type: "photo", media: fileId }));
    }
  }

  if (selectedPhotos.length === 0) return;

  try {
    if (selectedPhotos.length === 1) {
      await ctx.replyWithPhoto(selectedPhotos[0].media);
    } else {
      // Обмежуємо альбом до 5 фото на повідомлення, щоб не перевантажувати клієнта
      await ctx.replyWithMediaGroup(selectedPhotos.slice(0, 5));
    }
  } catch (err) {
    console.error("Помилка при відправці фото:", err);
  }
}

// ==========================================
// ОСНОВНА ОБРОБКА ТЕКСТОВИХ ПОВІДОМЛЕНЬ ВІД КЛІЄНТА
// ==========================================
bot.on("message:text", async (ctx) => {
  if (isDuplicate(ctx)) return;

  const chatId = ctx.chat.id;
  const userText = ctx.message.text.trim();
  const history = getChatHistory(chatId);

  // Зберігаємо репліку клієнта в пам'ять
  history.push({ role: "user", parts: [{ text: userText }] });
  if (history.length > 40) history.splice(0, history.length - 40);

  try {
    await ctx.replyWithChatAction("typing");

    // Динамічний промпт з найсвіжішим каталогом товарів
    const systemInstruction = generateShopPrompt(catalog);

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: history,
      config: {
        systemInstruction,
        maxOutputTokens: 350,
      },
    });

    let botReply = response.text || "";

    // Перевіряємо, чи викликав ШІ відправку фото через теги
    const photoMatch = botReply.match(/\[PHOTO:\s*([a-zA-Z0-9_-]+)\]/);
    const morePhotosMatch = botReply.match(/\[MORE_PHOTOS:\s*([a-zA-Z0-9_-]+)\]/);

    // Очищаємо текст від технічних тегів, щоб клієнт їх не бачив
    botReply = botReply
      .replace(/\[PHOTO:\s*([a-zA-Z0-9_-]+)\]/g, "")
      .replace(/\[MORE_PHOTOS:\s*([a-zA-Z0-9_-]+)\]/g, "")
      .trim();

    // Зберігаємо відповідь у пам'ять
    history.push({ role: "model", parts: [{ text: botReply }] });

    // 1. Надсилаємо текстову відповідь
    if (botReply) {
      await ctx.reply(botReply);
    }

    // 2. Якщо є тег первинних фото — надсилаємо 1-2 фото (з пріоритетом живих від власника)
    if (photoMatch) {
      const productId = photoMatch[1];
      await sendProductImages(ctx, productId, 2, false);
    }

    // 3. Якщо клієнт попросив більше фото — надсилаємо галерею інших живих фото
    if (morePhotosMatch) {
      const productId = morePhotosMatch[1];
      await sendProductImages(ctx, productId, 5, true);
    }
  } catch (error) {
    console.error("Помилка генерації або обробки:", error);
    await ctx.reply("Вибачте, виникла хвилинна затримка з мережею. Будь ласка, надішліть повідомлення ще раз 🙏");
  }
});

// Глобальний облов помилок
bot.catch((err) => {
  console.error("Помилка бота:", err.error);
});

// ==========================================
// ВЕБ-СЕРВЕР ДЛЯ ПІДТРИМКИ 24/7 НА RENDER
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", catalogItems: catalog.length }));
}).listen(PORT, () => {
  console.log(`[OK] Сервер активний на порту ${PORT}`);
});

bot.start();
