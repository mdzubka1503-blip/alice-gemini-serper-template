const DEFAULT_MODEL = "gemini-1.5-flash"; // Обновлено на стабильную рабочую версию
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_MESSAGE_CHARS = 1200;
const MAX_ALICE_TEXT = 1024;
const TOTAL_RESPONSE_BUDGET_MS = 3600;
const GEMINI_TIMEOUT_MS = 2500;

const SYSTEM_PROMPT = [
  "Ты — полезный голосовой помощник в навыке Яндекс Алисы.",
  "Отвечай естественно, по-русски, кратко и так, чтобы ответ было удобно слушать.",
  "Обычно используй 1-3 коротких предложения. Не используй Markdown, таблицы, списки с символами или длинные вступления.",
  "Если вопрос требует актуальных данных и переданы результаты поиска, опирайся на них; не выдумывай отсутствующие факты.",
  "Если не знаешь ответа, честно скажи об этом."
].join(" ");

function aliceResponse(text, endSession = false, history = []) {
  return {
    version: "1.0",
    response: {
      text: fitAliceText(text),
      end_session: endSession
    },
    session_state: { history }
  };
}

function fitAliceText(value) {
  const text = String(value ?? "")
    .replace(/[\(\r\\)n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (text.length <= MAX_ALICE_TEXT) return text || "Не удалось подготовить ответ.";

  const candidate = text.slice(0, MAX_ALICE_TEXT - 1);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );

  if (sentenceEnd >= 300) return candidate.slice(0, sentenceEnd + 1).trim();

  const lastSpace = candidate.lastIndexOf(" ");
  if (lastSpace >= 300) return candidate.slice(0, lastSpace).trim() + "...";

  return candidate.trim() + "...";
}

// Новая функция поиска, адаптированная под ваш SERPAPI_KEY
async function searchSerpApi(query) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return "";

  try {
    const url = `https://serpapi.com{encodeURIComponent(query)}&api_key=${apiKey}&engine=google&hl=ru&gl=ru`;
    
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);

    if (!res.ok) return "";
    const data = await res.json();

    if (data.organic_results && data.organic_results.length > 0) {
      return data.organic_results
        .slice(0, 2)
        .map(r => `${r.title}: ${r.snippet}`)
        .join("\n");
    }
    return "";
  } catch (e) {
    console.error("SerpApi error:", e);
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const request = body.request || {};
    const sessionState = body.session_state || {};
    let history = Array.isArray(sessionState.history) ? sessionState.history : [];

    if (body.session?.new) {
      history = [];
    }

    const utterance = (request.original_utterance || "").trim();
    if (!utterance) {
      return res.status(200).json(aliceResponse("Привет! Я твой умный ассистент на базе Gemini. О чем хочешь поговорить?", false, history));
    }

    // Запускаем поиск параллельно, если в запросе есть намек на поиск свежих данных
    const lowerUtterance = utterance.toLowerCase();
    const needsSearch = lowerUtterance.includes("кто") || 
                        lowerUtterance.includes("что") || 
                        lowerUtterance.includes("почему") || 
                        lowerUtterance.includes("новости") || 
                        lowerUtterance.includes("сегодня") ||
                        lowerUtterance.includes("сколько");

    let searchContext = "";
    if (needsSearch) {
      searchContext = await searchSerpApi(utterance);
    }

    // Собираем историю для Gemini
    history.push({ role: "user", text: utterance });
    if (history.length > MAX_HISTORY_MESSAGES) {
      history = history.slice(-MAX_HISTORY_MESSAGES);
    }

    const geminiMessages = [{ role: "system", parts: [{ text: SYSTEM_PROMPT }] }];
    
    if (searchContext) {
      geminiMessages.push({ 
        role: "system", 
        parts: [{ text: `Актуальная информация из интернета для ответа на текущий вопрос:\n${searchContext}` }] 
      });
    }

    let currentChars = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (currentChars + msg.text.length > MAX_HISTORY_MESSAGE_CHARS) break;
      geminiMessages.splice(1, 0, {
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      });
      currentChars += msg.text.length;
    }

    // Запрос к Gemini API напрямую без лишних библиотек
    const geminiUrl = `https://googleapis.com{DEFAULT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: geminiMessages })
    });

    if (!geminiRes.ok) {
      throw new Error(`Gemini API вернул статус ${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    const replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Не удалось получить ответ от нейросети.";

    history.push({ role: "model", text: replyText });

    return res.status(200).json(aliceResponse(replyText, false, history));

  } catch (error) {
    console.error("Handler error:", error);
    return res.status(200).json(aliceResponse(`Произошла ошибка на сервере: ${error.message}. Проверьте логи Vercel.`, false, []));
  }
}
