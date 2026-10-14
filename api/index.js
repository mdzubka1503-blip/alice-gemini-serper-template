// Простой и надежный обработчик для Яндекс.Диалогов и Gemini
export default async function handler(req, res) {
  // Навык Алисы работает только через POST-запросы
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
    
    // Фраза, которую произнес пользователь
    const userMessage = (request.command || "").trim();

    // Защита от пустых или проверочных запросов Яндекса
    if (!userMessage) {
      return res.status(200).json({
        response: { text: "Привет! Я твой умный ассистент Джарвис на базе Gemini. О чем хочешь поговорить?", end_session: false },
        version: version
      });
    }

    // 1. Поиск информации в Google через SerpAPI
    let searchContext = "";
    const lowerMsg = userMessage.toLowerCase();
    const needsSearch = lowerMsg.includes("кто") || lowerMsg.includes("что") || lowerMsg.includes("новости") || lowerMsg.includes("сегодня") || lowerMsg.includes("сколько");

    if (needsSearch && process.env.SERPAPI_KEY) {
      try {
        const queryParam = encodeURIComponent(userMessage);
        const url = "https://serpapi.com" + queryParam + "&api_key=" + process.env.SERPAPI_KEY + "&engine=google&hl=ru&gl=ru";
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

    // 2. Настройка инструкций для нейросети
    let systemPrompt = "Ты — полезный голосовой ассистент Джарвис для Алисы. Отвечай кратко (1-3 коротких предложения), по-русски, без списков, разметки Markdown и спецсимволов, чтобы текст было удобно слушать голосом.";
    if (searchContext) {
      systemPrompt += " Используй этот актуальный факт из интернета для ответа: " + searchContext;
    }

    // 3. Отправка прямого запроса в Google Gemini API
    const geminiUrl = "https://googleapis.com" + process.env.GEMINI_API_KEY;
    
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n\nВопрос пользователя: " + userMessage }] }
        ]
      })
    });

    if (!geminiRes.ok) {
      throw new Error("Gemini API вернул ошибку " + geminiRes.status);
    }

    const geminiData = await geminiRes.json();
    let botResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Не удалось сгенерировать ответ.";
    
    // Очищаем текст от символов разметки, которые ломают чтение Алисы
    botResponse = botResponse.replace(/[*#`_\-\[\]()]/g, "").trim();

    // Возвращаем строго валидный JSON, который требует Яндекс
    return res.status(200).json({
      response: {
        text: botResponse.slice(0, 1000), // Ограничение по длине сообщения в Алисе
        end_session: false
      },
      version: version
    });

  } catch (error) {
    // Безопасный перехват ошибок: если что-то упало, мы пишем текст ошибки в чат, а не вешаем сервер
    return res.status(200).json({
      response: {
        text: "Джарвис столкнулся с внутренней ошибкой: " + error.message,
        end_session: false
      },
      version: "1.0"
    });
  }
}
