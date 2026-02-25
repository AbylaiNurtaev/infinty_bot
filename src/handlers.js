import { createApiClient } from './api.js';
import { store } from './store.js';

const MIN_BALANCE_FOR_SPIN = 20;
const GEO_SESSION_MS = 60 * 60 * 1000; // 60 минут
const SPIN_LIMIT = 5;
const SPIN_WINDOW_MS = 10 * 60 * 1000; // 10 минут

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTransaction(t) {
  const typeLabel =
    t.type === 'earned' || t.type === 'registration_bonus' || t.type === 'prize_points' || t.type === 'referral_bonus'
      ? '➕ Начислено'
      : t.type === 'spent' || t.type === 'spin_cost'
        ? '➖ Списано'
        : '🎁 Приз';
  const amount = Math.abs(t.amount || 0);
  const sign = t.amount > 0 ? '+' : '−';
  return `${typeLabel} ${sign}${amount} б. — ${t.description || '—'} (${formatDate(t.createdAt || t.date)})`;
}

function formatPrize(p) {
  const name = p.name || p.prizeId?.name || 'Приз';
  const status =
    p.status === 'pending'
      ? 'Ожидает подтверждения'
      : p.status === 'confirmed'
        ? 'Подтверждён'
        : p.status === 'issued'
          ? 'Выдан'
          : p.status || '—';
  const wonAt = p.createdAt || p.wonAt;
  return `🎁 ${name}\n   Статус: ${status}\n   Дата: ${formatDate(wonAt)}`;
}

/** Нормализуем номер из Telegram (+79001234567 → 79001234567) */
function normalizePhone(phoneNumber) {
  const digits = (phoneNumber || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.startsWith('7') || digits.startsWith('8') ? '7' + digits.slice(-10) : '7' + digits;
}

/** Текст статуса гео-сессии: "Сессия активна до 18:40 (ещё 57 минут)" или null */
function getSessionStatusText(userId) {
  const session = store.getGeoSession(userId);
  if (!session) return null;
  const end = new Date(session.expiresAt);
  const minsLeft = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 60000));
  const timeStr = end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `Сессия активна до ${timeStr} (ещё ${minsLeft} мин.)`;
}

/** Клавиатура «Войти» — без отправки номера; по нажатию показываем запрос контакта в /login */
function loginPromptKeyboard() {
  return {
    keyboard: [[{ text: 'Войти' }]],
    resize_keyboard: true,
  };
}

/** Клавиатура по состоянию: Войти / Подтвердить клуб / Крутить рулетку + баланс и профиль */
function mainKeyboard(userId) {
  const token = store.getToken(userId);
  if (!token) {
    return loginPromptKeyboard();
  }
  const geo = store.getGeoSession(userId);
  if (!geo) {
    return {
      keyboard: [
        [{ text: '💰 Мой баланс' }, { text: '📍 Подтвердить клуб', request_location: true }],
        [{ text: '👤 Мой профиль' }, { text: '👥 Пригласить друга' }],
      ],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [
      [{ text: '💰 Мой баланс' }, { text: '🎰 Крутить рулетку' }],
      [{ text: '👤 Мой профиль' }, { text: '👥 Пригласить друга' }],
    ],
    resize_keyboard: true,
  };
}

/** Клавиатура в профиле (история, призы, изменить имя) */
function profileInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📜 История рулеток', callback_data: 'profile_history' }],
      [{ text: '🎁 Мои призы', callback_data: 'profile_prizes' }],
      [{ text: '✏️ Изменить имя', callback_data: 'profile_change_name' }],
    ],
  };
}

/** Показать баланс (общая логика для /balance и кнопки) */
async function sendBalance(bot, chatId, userId) {
  const token = store.getToken(userId);
  if (!token) {
    await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
    return;
  }
  const api = createApiClient(token);
  try {
    const data = await api.getPlayerBalance();
    const balance = data.balance ?? 0;
    const geo = store.getGeoSession(userId);
    const hint = balance < MIN_BALANCE_FOR_SPIN
      ? `Для одного спина нужно ${MIN_BALANCE_FOR_SPIN} баллов.`
      : geo
        ? 'Нажмите «Крутить рулетку».'
        : 'Подтвердите клуб (отправьте геолокацию).';
    const sessionLine = getSessionStatusText(userId) ? '\n' + getSessionStatusText(userId) : '';
    await bot.sendMessage(
      chatId,
      `💰 Ваш баланс: ${balance} баллов.\n${hint}${sessionLine}`,
      { reply_markup: mainKeyboard(userId) }
    );
  } catch (err) {
    if (err.response?.status === 401) {
      store.removeToken(userId);
      await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
    } else {
      await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
    }
  }
}

/** Показать экран профиля: данные игрока + кнопки (история, призы, изменить имя) */
async function sendProfile(bot, chatId, userId) {
  const token = store.getToken(userId);
  if (!token) {
    await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
    return;
  }
  const api = createApiClient(token);
  try {
    const [me, balanceRes] = await Promise.all([api.getPlayerMe(), api.getPlayerBalance()]);
    const name = me?.name || '—';
    const phone = me?.phone || '—';
    const balance = balanceRes?.balance ?? 0;
    const lines = [
      '👤 Мой профиль',
      '',
      `Имя: ${name}`,
      `Телефон: ${phone}`,
      `Баланс: ${balance} баллов`,
      '',
      'Выберите действие:',
    ];
    await bot.sendMessage(chatId, lines.join('\n'), {
      reply_markup: { ...profileInlineKeyboard() },
    });
  } catch (err) {
    if (err.response?.status === 401) {
      store.removeToken(userId);
      await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
    } else {
      await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
    }
  }
}

/** Крутить рулетку по геолокации (проверка «в клубе» на бэкенде) */
async function doSpin(bot, chatId, userId, latitude, longitude) {
  const token = store.getToken(userId);
  if (!token) {
    await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
    return;
  }
  const api = createApiClient(token);
  try {
    const balanceRes = await api.getPlayerBalance();
    const balance = balanceRes.balance ?? 0;
    if (balance < MIN_BALANCE_FOR_SPIN) {
      await bot.sendMessage(chatId, `❌ Недостаточно баллов. Нужно ${MIN_BALANCE_FOR_SPIN}, у вас ${balance}.`, { reply_markup: mainKeyboard(userId) });
      return;
    }
    const spinData = await api.spinRoulette(latitude, longitude);
    const prize = spinData?.spin?.prize || spinData?.prize;
    const newBalance = spinData?.newBalance ?? balance - MIN_BALANCE_FOR_SPIN;
    const prizeName = prize?.name || prize?.prizeId?.name || 'Приз';
    await bot.sendMessage(chatId, '🎰 Крутим рулетку…', { reply_markup: mainKeyboard(userId) });
    const resultText = `🎰 Рулетка прокручена!\n\n🎁 Вы выиграли: ${prizeName}\n💰 Новый баланс: ${newBalance} баллов.`;
    setTimeout(() => {
      bot.sendMessage(chatId, resultText, { reply_markup: mainKeyboard(userId) }).catch(() => {});
    }, 29000);
  } catch (err) {
    if (err.response?.status === 401) {
      store.removeToken(userId);
      await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
      return;
    }
    if (err.response?.status === 429) {
      const message = err.response?.data?.message || 'Рулетка занята, попробуйте позже';
      const retryAfter = err.response?.data?.retryAfterSeconds ?? 15;
      const text = `❌ ${message}\n\nПопробуйте снова через ${retryAfter} сек.`;
      await bot.sendMessage(chatId, text, { reply_markup: mainKeyboard(userId) });
      return;
    }
    const message = err.response?.data?.message || err.message || 'Ошибка прокрутки';
    const isOutOfRadius = /не в радиусе|200\s*м/i.test(String(message));
    if (isOutOfRadius) {
      store.clearGeoSession(userId);
      await bot.sendMessage(chatId, '❌ ' + message, {
        reply_markup: mainKeyboard(userId),
      });
    } else {
      await bot.sendMessage(chatId, '❌ ' + message, { reply_markup: mainKeyboard(userId) });
    }
  }
}

/** Регистрируем все хендлеры на bot */
export function registerHandlers(bot) {
  // ——— Получили геолокацию — подтверждение клуба (гео-сессия 60 мин) ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!msg.location) return;

    const token = store.getToken(userId);
    if (!token) return; // не залогинен — игнорируем случайную геолокацию

    const lat = msg.location.latitude;
    const lon = msg.location.longitude;
    store.setGeoSession(userId, lat, lon, GEO_SESSION_MS);
    const statusText = getSessionStatusText(userId);
    await bot.sendMessage(
      chatId,
      `✅ Геолокация получена.\n\n${statusText || 'Сессия активна.'}\n\nМожно крутить рулетку.`,
      { reply_markup: mainKeyboard(userId) }
    );
  });

  // ——— Получили контакт из Telegram — пробуем вход, при необходимости просим имя для регистрации ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!msg.contact) return;

    const pending = store.getPendingLogin(chatId);
    if (!pending || pending.step !== 'await_code' || pending.phone) return;

    const phone = normalizePhone(msg.contact.phone_number);
    if (!phone) {
      await bot.sendMessage(chatId, 'Не удалось определить номер. Нажмите /login и отправьте контакт снова.');
      return;
    }
    store.clearPendingLogin(chatId);
    await bot.sendMessage(chatId, 'Входим…', { reply_markup: { remove_keyboard: true } });

    const api = createApiClient();
    const code = '0000';
    try {
      let data = await api.login(phone, code);
      if (data && data.token) {
        store.setToken(userId, data.token, phone);
        await bot.sendMessage(chatId, `✅ Вы вошли!\nТелефон: ${phone}`, {
          reply_markup: mainKeyboard(userId),
        });
        return;
      }
    } catch (_) {
      // Вход не удался — пользователь не зарегистрирован, идём в регистрацию (код друга → имя)
    }
    // Требуется регистрация: всегда сначала код друга (с Пропустить), потом имя
    store.setPendingLoginAwaitRef(chatId, phone);
    await bot.sendMessage(chatId, 'Введите код друга (6 букв/цифр, например K7MN2P) или нажмите «Пропустить».', {
      reply_markup: {
        keyboard: [[{ text: 'Пропустить' }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
  });

  // ——— Inline-кнопки в профиле (история, призы, изменить имя) ———
  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat?.id;
    const userId = query.from?.id;
    const data = query.data;
    if (!chatId || !data?.startsWith('profile_')) return;

    await bot.answerCallbackQuery(query.id);

    if (data === 'profile_history') {
      const token = store.getToken(userId);
      if (!token) {
        await bot.sendMessage(chatId, 'Сначала войдите.');
        return;
      }
      const api = createApiClient(token);
      try {
        const list = await api.getPlayerTransactions();
        const transactions = Array.isArray(list) ? list : [];
        if (transactions.length === 0) {
          await bot.sendMessage(chatId, '📜 История транзакций пуста.');
        } else {
          const lines = transactions.slice(0, 25).map(formatTransaction);
          const text = '📜 История транзакций:\n\n' + lines.join('\n');
          await bot.sendMessage(chatId, text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);
        }
      } catch (err) {
        await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
      }
      return;
    }
    if (data === 'profile_prizes') {
      const token = store.getToken(userId);
      if (!token) {
        await bot.sendMessage(chatId, 'Сначала войдите.');
        return;
      }
      const api = createApiClient(token);
      try {
        const list = await api.getPlayerPrizes();
        const prizes = Array.isArray(list) ? list : [];
        if (prizes.length === 0) {
          await bot.sendMessage(chatId, '🎁 У вас пока нет призов.');
        } else {
          const text = '🎁 Мои призы:\n\n' + prizes.slice(0, 20).map(formatPrize).join('\n\n');
          await bot.sendMessage(chatId, text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);
        }
      } catch (err) {
        await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
      }
      return;
    }
    if (data === 'profile_change_name') {
      store.setPendingChangeName(chatId);
      await bot.sendMessage(chatId, 'Введите новое имя:', { reply_markup: mainKeyboard(userId) });
    }
    if (data === 'referral_enter_code') {
      store.setAwaitReferralCode(chatId);
      await bot.sendMessage(
        chatId,
        'Отправь код друга (6 букв/цифр, например K7MN2P). Его тебе мог прислать пригласивший.'
      );
    }
  });

  // ——— Ожидание кода друга: 6 символов (K7MN2P) или ref_K7MN2P; бэкенд принимает оба формата ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    if (!store.getAwaitReferralCode(chatId) || !text || /^\/\w+/.test(text)) return;
    if (msg.contact || msg.location) return;
    const validCode = /^(ref_)?[A-Za-z0-9]{6}$/.test(text);
    if (!validCode) {
      await bot.sendMessage(chatId, 'Введи 6-значный код друга (например K7MN2P). Попробуй ещё раз или нажми /login.');
      return;
    }
    store.clearAwaitReferralCode(chatId);
    store.setReferralPayload(userId, text);
    await bot.sendMessage(
      chatId,
      '✅ Код друга сохранён. Нажми «📱 Войти» или /login — баллы пригласившему начислятся после твоего первого платного спина.',
      { reply_markup: mainKeyboard(userId) }
    );
  });

  // ——— Ожидание нового имени (из профиля) ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    if (!store.getPendingChangeName(chatId) || !text || /^\/\w+/.test(text)) return;
    if (msg.contact || msg.location) return;

    store.clearPendingChangeName(chatId);
    const api = createApiClient(store.getToken(userId));
    try {
      await api.updatePlayerMe({ name: text });
      await bot.sendMessage(chatId, `✅ Имя изменено на «${text}»`, { reply_markup: mainKeyboard(userId) });
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Не удалось изменить имя';
      await bot.sendMessage(chatId, '❌ ' + message, { reply_markup: mainKeyboard(userId) });
    }
  });

  // ——— Ожидание кода друга при регистрации (или «Пропустить») ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    const pendingLogin = store.getPendingLogin(chatId);
    if (pendingLogin?.step !== 'await_ref' || !pendingLogin.phone || !text || /^\/\w+/.test(text)) return;
    if (msg.contact || msg.location) return;

    const isSkip = /^(пропустить|skip)$/i.test(text);
    const validCode = /^(ref_)?[A-Za-z0-9]{6}$/.test(text);
    if (isSkip) {
      store.setPendingLoginAwaitName(chatId, pendingLogin.phone);
      await bot.sendMessage(chatId, 'Введите ваше имя для регистрации:', {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    if (validCode) {
      store.setReferralPayload(userId, text);
      store.setPendingLoginAwaitName(chatId, pendingLogin.phone);
      await bot.sendMessage(chatId, 'Код друга сохранён. Введите ваше имя для регистрации:', {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    await bot.sendMessage(
      chatId,
      'Введите 6-значный код друга (например K7MN2P) или нажмите «Пропустить».'
    );
  });

  // ——— Ожидание имени при регистрации ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    const pendingLogin = store.getPendingLogin(chatId);
    if (pendingLogin?.step !== 'await_name' || !pendingLogin.phone || !text || /^\/\w+/.test(text)) {
      if (pendingLogin?.step === 'await_name') return;
      return;
    }
    if (msg.contact || msg.location) return;
    // Не принимать реферальный код как имя (тот же message может обработать и await_ref, и этот handler)
    if (/^(ref_)?[A-Za-z0-9]{6}$/.test(text)) {
      await bot.sendMessage(chatId, 'Введите ваше имя для регистрации (не код):');
      return;
    }
    const api = createApiClient();
    const code = '0000';
    const ref = store.getReferralPayload(userId);
    try {
      const data = await api.register(pendingLogin.phone, code, text, ref);
      store.clearPendingLogin(chatId);
      if (ref) store.clearReferralPayload(userId);
      if (data && data.token) {
        store.setToken(userId, data.token, pendingLogin.phone);
        await bot.sendMessage(chatId, `✅ Вы зарегистрированы!\nТелефон: ${pendingLogin.phone}`, {
          reply_markup: mainKeyboard(userId),
        });
      } else {
        await bot.sendMessage(chatId, '❌ Не удалось зарегистрироваться. Попробуйте /login снова.');
      }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Ошибка регистрации';
      await bot.sendMessage(chatId, `❌ ${message}\nПопробуйте /login снова.`);
    }
    return;
  });

  // ——— Кнопки и спин ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    if (msg.contact) return; // контакт — отдельный обработчик
    const pendingLogin = store.getPendingLogin(chatId);
    if (pendingLogin) return; // в процессе входа

    // Кнопка «Войти» — показать запрос номера (команда /login)
    if (text === 'Войти') {
      if (!store.getToken(userId)) {
        store.setPendingLogin(chatId, null);
        await bot.sendMessage(chatId, 'Нажмите кнопку ниже, чтобы отправить номер телефона из Telegram.', {
          reply_markup: {
            keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        });
      }
      return;
    }

    // Кнопка «Мой баланс»
    if (text === '💰 Мой баланс') {
      await sendBalance(bot, chatId, userId);
      return;
    }
    // Кнопка «Крутить рулетку» — проверяем гео-сессию и лимит спинов
    if (text === '🎰 Крутить рулетку') {
      const token = store.getToken(userId);
      if (!token) {
        await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
        return;
      }
      const geo = store.getGeoSession(userId);
      if (!geo) {
        await bot.sendMessage(
          chatId,
          'Сессия закончилась — подтвердите клуб ещё раз.',
          { reply_markup: mainKeyboard(userId) }
        );
        return;
      }
      const phone = store.getPhone(userId) || '';
      const exemptPhone = /^8?77715943738$/.test(String(phone).replace(/\D/g, ''));
      if (!exemptPhone && !store.canSpin(userId)) {
        await bot.sendMessage(
          chatId,
          'Превышен лимит: не более 5 спинов за 10 минут. Попробуйте позже.',
          { reply_markup: mainKeyboard(userId) }
        );
        return;
      }
      if (!exemptPhone) store.recordSpin(userId);
      await doSpin(bot, chatId, userId, geo.latitude, geo.longitude);
      return;
    }
    // Кнопка «Мой профиль»
    if (text === '👤 Мой профиль') {
      await sendProfile(bot, chatId, userId);
      return;
    }
    // Кнопка «Пригласить друга» — только код: первое сообщение с текстом и кодом, второе — только код для копирования
    if (text === '👥 Пригласить друга') {
      const token = store.getToken(userId);
      if (!token) {
        await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
        return;
      }
      const api = createApiClient(token);
      try {
        const me = await api.getPlayerMe();
        const referralCode = me?.referralCode || null;
        const points = me?.referralPointsPerFriend ?? 5;
        const lines = [
          '👥 Ваш реферальный код',
          '',
          referralCode ? referralCode : '',
          '',
          'Друг вводит этот код в боте при регистрации.',
          '',
          `Ты получишь ${points} баллов, когда друг зарегистрируется и сделает 1‑й платный спин.`,
        ].filter(Boolean);
        await bot.sendMessage(chatId, lines.join('\n'));
        if (referralCode) {
          await bot.sendMessage(chatId, referralCode);
        }
      } catch (err) {
        if (err.response?.status === 401) {
          store.removeToken(userId);
          await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
        } else {
          await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
        }
      }
      return;
    }
  });

  // ——— /start [ref_XXX] — реферальная ссылка. Payload берём из текста (на некоторых клиентах кнопка «Start» шлёт только /start) ———
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const rawText = (msg.text || '').trim();
    const payloadFromRegex = match && match[1] && match[1].trim();
    const payloadFromText = rawText.startsWith('/start') ? rawText.slice(6).trim() || null : null;
    const payload = payloadFromRegex || payloadFromText || null;
    if (payload) store.setReferralPayload(userId, payload);

    const token = store.getToken(userId);
    const lines = [
      '👋 Добро пожаловать в бот клуба!',
      '',
      payload
        ? 'Вы перешли по приглашению. Войдите или зарегистрируйтесь — баллы пригласившему начислятся после вашего первого платного спина.'
        : '',
      token
        ? 'Вы авторизованы. Используйте кнопки ниже или команды.'
        : 'Для доступа к балансу и рулетке нужно войти.',
      '',
      '📱 /login — войти',
      '💰 /balance — баланс',
      '🎰 /spin — крутить рулетку (после подтверждения клуба)',
      '👤 /profile — мой профиль',
      '👥 Пригласить друга — реферальная ссылка',
      '🎁 /prizes — мои призы',
      '📜 /history — история',
      '🏆 /recent — последние выигрыши',
      '🚪 /logout — выйти',
    ].filter(Boolean);
    await bot.sendMessage(chatId, lines.join('\n'), {
      reply_markup: mainKeyboard(userId),
    });
    if (!payload && !token) {
      await bot.sendMessage(chatId, 'У тебя есть код друга? Нажми кнопку ниже и введи его (6 букв/цифр, например K7MN2P).', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔗 Ввести код друга', callback_data: 'referral_enter_code' }]],
        },
      });
    }
  });

  // ——— /login ———
  bot.onText(/\/login/, async (msg) => {
    const chatId = msg.chat.id;
    store.setPendingLogin(chatId, null);
    await bot.sendMessage(chatId, 'Нажмите кнопку ниже, чтобы отправить номер телефона из Telegram.', {
      reply_markup: {
        keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
  });

  // ——— /balance ———
  bot.onText(/\/(balance|баланс)/i, async (msg) => {
    await sendBalance(bot, msg.chat.id, msg.from?.id);
  });

  // ——— /profile ———
  bot.onText(/\/(profile|профиль)/i, async (msg) => {
    await sendProfile(bot, msg.chat.id, msg.from?.id);
  });

  // ——— /spin — как кнопка: проверка гео-сессии и лимита, затем спин
  bot.onText(/\/spin$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);
    if (!token) {
      await bot.sendMessage(chatId, 'Сначала войдите.', { reply_markup: mainKeyboard(userId) });
      return;
    }
    const geo = store.getGeoSession(userId);
    if (!geo) {
      await bot.sendMessage(
        chatId,
        'Сессия закончилась — подтвердите клуб ещё раз.',
        { reply_markup: mainKeyboard(userId) }
      );
      return;
    }
    const phone = store.getPhone(userId) || '';
    const exemptPhone = /^8?77715943738$/.test(String(phone).replace(/\D/g, ''));
    if (!exemptPhone && !store.canSpin(userId)) {
      await bot.sendMessage(
        chatId,
        'Превышен лимит: не более 5 спинов за 10 минут. Попробуйте позже.',
        { reply_markup: mainKeyboard(userId) }
      );
      return;
    }
    if (!exemptPhone) store.recordSpin(userId);
    await doSpin(bot, chatId, userId, geo.latitude, geo.longitude);
  });

  // ——— /prizes ———
  bot.onText(/\/(prizes|призы)/i, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);
    if (!token) {
      await bot.sendMessage(chatId, 'Сначала войдите.');
      return;
    }
    const api = createApiClient(token);
    try {
      const list = await api.getPlayerPrizes();
      const prizes = Array.isArray(list) ? list : [];
      if (prizes.length === 0) {
        await bot.sendMessage(chatId, '🎁 У вас пока нет призов.');
        return;
      }
      const text = '🎁 Мои призы:\n\n' + prizes.slice(0, 20).map(formatPrize).join('\n\n');
      await bot.sendMessage(chatId, text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);
    } catch (err) {
      if (err.response?.status === 401) {
        store.removeToken(userId);
        await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
      } else {
        await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
      }
    }
  });

  // ——— /history ———
  bot.onText(/\/(history|история)/i, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);
    if (!token) {
      await bot.sendMessage(chatId, 'Сначала войдите.');
      return;
    }
    const api = createApiClient(token);
    try {
      const list = await api.getPlayerTransactions();
      const transactions = Array.isArray(list) ? list : [];
      if (transactions.length === 0) {
        await bot.sendMessage(chatId, '📜 История транзакций пуста.');
        return;
      }
      const lines = transactions.slice(0, 25).map(formatTransaction);
      const text = '📜 История транзакций:\n\n' + lines.join('\n');
      await bot.sendMessage(chatId, text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);
    } catch (err) {
      if (err.response?.status === 401) {
        store.removeToken(userId);
        await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
      } else {
        await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
      }
    }
  });

  // ——— /recent — последние выигрыши (публичный) ———
  bot.onText(/\/(recent|выигрыши)/i, async (msg) => {
    const chatId = msg.chat.id;
    const api = createApiClient();
    try {
      const list = await api.getRecentWins();
      if (!list || list.length === 0) {
        await bot.sendMessage(chatId, '🏆 Пока нет последних выигрышей.');
        return;
      }
      const lines = list.slice(0, 15).map((w) => w.text || `${w.maskedPhone || '***'} — ${w.prizeName || 'приз'}`);
      const text = '🏆 Последние выигрыши:\n\n' + lines.join('\n');
      await bot.sendMessage(chatId, text.length > 4000 ? text.slice(0, 4000) + '\n…' : text);
    } catch (err) {
      await bot.sendMessage(chatId, '❌ ' + (err.response?.data?.message || err.message));
    }
  });

  // ——— /logout ———
  bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    store.removeToken(userId);
    store.clearPendingLogin(chatId);
    await bot.sendMessage(chatId, 'Вы вышли. Для входа снова: /login');
  });

}
