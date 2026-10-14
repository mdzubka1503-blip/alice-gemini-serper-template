// Простой и надежный обработчик для Яндекс.Диалогов и Gemini
export default async function handler(req, res) {
  // Яндекс Диалоги всегда отправляют запросы методом POST
  if (req.method !== 'POST') {
    return res.status(200).json({
      response: { text: "Привет! Я работаю только через Яндекс Алису.", end_session: true },
      version: "1.0"
    });
  }

  try {
    const body = req.body || {};
    const request = body.request || {};
    const version = body.version || "1.0";
    
    // Получаем фразу пользователя
    const userMessage = (request.command || "").trim();

    // Если запрос пустой (первый запуск/проверка от Яндекса)
    if (!userMessage) {
      return res.status(200).json({
        response: { text: "Привет! Я твой умный ассистент Джарвис на базе Gemini. О чем хочешь поговорить?", end_session: false },
        version: version
      });
    }

    // 1. Попытка сделать быстрый поиск через SerpAPI, если юзер спрашивает факты
    let searchContext = "";
    const lowerMsg = userMessage.toLowerCase();
    const needsSearch = lowerMsg.includes("кто") || lowerMsg.includes("что") || lowerMsg.includes("новости") || lowerMsg.includes("сегодня") || lowerMsg.includes("сколько");

    if (needsSearch && process.env.SERPAPI_KEY) {
      try {
        const url = `https://serpapi.com\({encodeURIComponent(userMessage)}&api_key=\){process.env.SERPAPI_KEY}&engine=google&hl=ru&gl=ru`;
        const serpRes = await fetch(url);
        if (serpRes.ok) {
          const serpData = await serpRes.json();
          if (serpData.organic_results && serpData.organic_results.length > 0) {
            searchContext = serpData.organic_results.slice(0, 2).map(r => r.snippet).join(" ");
          }
        }
      } catch (e) {
        console.error("SerpAPI Error:", e);
      }
    }

    // 2. Формируем системный промт для Gemini
    let systemPrompt = "Ты — полезный голосовой ассистент Джарвис для Алисы. Отвечай кратко (1-3 коротких предложения), по-русски, без списков, разметки Markdown и спецсимволов, чтобы текст было удобно слушать голосом.";
    if (searchContext) {
      systemPrompt += ` Используй этот актуальный факт из интернета для ответа: \${searchContext}`;
    }

    // 3. Запрос к API Gemini напрямую
    const geminiUrl = `https://googleapis.com\${process.env.GEMINI_API_KEY}`;
    
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `\({systemPrompt}\n\nВопрос пользователя: \){userMessage}` }] }
        ]
      })
    });

    if (!geminiRes.ok) {
      throw new Error(`Gemini вернул статус \${geminiRes.status}`);
    }

    const geminiData = await geminiRes.json();
    let botResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Не удалось сгенерировать ответ.";
    
    // Очищаем текст от возможных символов разметки, которые ломают озвучку Алисы
    botResponse = botResponse.replace(/[*#`_\-\[\]()]/g, "").trim();

    // Отправляем строго валидный ответ для Яндекса
    return res.status(200).json({
      response: {
        text: botResponse.slice(0, 1000), // Защита от превышения лимитов Алисы в 1024 символа
        end_session: false
      },
      version: version
    });

  } catch (error) {
    // В случае любой внутренней ошибки ловим её и отдаем текстом, чтобы Яндекс не выдавал 400 ошибку
    return res.status(200).json({
      response: {
        text: `Джарвис столкнулся с ошибкой: ${error.message}. Проверьте переменные окружения.`,
        end_session: false
      },
      version: "1.0"
    });
  }
}
