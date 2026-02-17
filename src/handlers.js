import { createApiClient } from './api.js';
import { store } from './store.js';

const MIN_BALANCE_FOR_SPIN = 20;

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
    t.type === 'earned' || t.type === 'registration_bonus' || t.type === 'prize_points'
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

/** Клавиатура после входа: 3 кнопки */
function mainKeyboard() {
  return {
    keyboard: [
      [{ text: '💰 Мой баланс' }, { text: '🎰 Крутить рулетку' }],
      [{ text: '👤 Мой профиль' }],
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
    await bot.sendMessage(chatId, 'Сначала войдите: /login');
    return;
  }
  const api = createApiClient(token);
  try {
    const data = await api.getPlayerBalance();
    const balance = data.balance ?? 0;
    await bot.sendMessage(
      chatId,
      `💰 Ваш баланс: ${balance} баллов.\n${balance < MIN_BALANCE_FOR_SPIN ? `Для одного спина нужно ${MIN_BALANCE_FOR_SPIN} баллов.` : 'Нажмите «Крутить рулетку» и отправьте геолокацию.'}`,
      { reply_markup: mainKeyboard() }
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
    await bot.sendMessage(chatId, 'Сначала войдите: /login');
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
    await bot.sendMessage(chatId, 'Сначала войдите: /login');
    return;
  }
  const api = createApiClient(token);
  try {
    const balanceRes = await api.getPlayerBalance();
    const balance = balanceRes.balance ?? 0;
    if (balance < MIN_BALANCE_FOR_SPIN) {
      await bot.sendMessage(chatId, `❌ Недостаточно баллов. Нужно ${MIN_BALANCE_FOR_SPIN}, у вас ${balance}.`, { reply_markup: mainKeyboard() });
      return;
    }
    const spinData = await api.spinRoulette(latitude, longitude);
    const prize = spinData?.spin?.prize || spinData?.prize;
    const newBalance = spinData?.newBalance ?? balance - MIN_BALANCE_FOR_SPIN;
    const prizeName = prize?.name || prize?.prizeId?.name || 'Приз';
    await bot.sendMessage(chatId, '🎰 Крутим рулетку…', { reply_markup: mainKeyboard() });
    const resultText = `🎰 Рулетка прокручена!\n\n🎁 Вы выиграли: ${prizeName}\n💰 Новый баланс: ${newBalance} баллов.`;
    setTimeout(() => {
      bot.sendMessage(chatId, resultText, { reply_markup: mainKeyboard() }).catch(() => {});
    }, 15000);
  } catch (err) {
    if (err.response?.status === 401) {
      store.removeToken(userId);
      await bot.sendMessage(chatId, 'Сессия истекла. Войдите снова: /login');
    } else {
      const message = err.response?.data?.message || err.message || 'Ошибка прокрутки';
      await bot.sendMessage(chatId, '❌ ' + message, { reply_markup: mainKeyboard() });
    }
  }
}

/** Регистрируем все хендлеры на bot */
export function registerHandlers(bot) {
  // ——— Получили геолокацию — спин (если ждали локацию) ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!msg.location) return;

    if (!store.getPendingSpin(chatId)) return;

    const lat = msg.location.latitude;
    const lon = msg.location.longitude;
    store.clearPendingSpin(chatId);
    await doSpin(bot, chatId, userId, lat, lon);
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
          reply_markup: mainKeyboard(),
        });
        return;
      }
    } catch (_) {
      // Вход не удался — возможно, пользователь не зарегистрирован
    }
    // Требуется регистрация: запрашиваем имя
    store.setPendingLoginAwaitName(chatId, phone);
    await bot.sendMessage(chatId, 'Введите ваше имя для регистрации:');
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
        await bot.sendMessage(chatId, 'Сначала войдите: /login');
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
        await bot.sendMessage(chatId, 'Сначала войдите: /login');
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
      await bot.sendMessage(chatId, 'Введите новое имя:', { reply_markup: mainKeyboard() });
    }
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
      await bot.sendMessage(chatId, `✅ Имя изменено на «${text}»`, { reply_markup: mainKeyboard() });
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Не удалось изменить имя';
      await bot.sendMessage(chatId, '❌ ' + message, { reply_markup: mainKeyboard() });
    }
  });

  // ——— Ожидание имени при регистрации ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    const pendingLogin = store.getPendingLogin(chatId);
    if (pendingLogin?.step === 'await_name' && pendingLogin.phone && text && !/^\/\w+/.test(text)) {
      const api = createApiClient();
      const code = '0000';
      try {
        const data = await api.register(pendingLogin.phone, code, text);
        store.clearPendingLogin(chatId);
        if (data && data.token) {
          store.setToken(userId, data.token, pendingLogin.phone);
          await bot.sendMessage(chatId, `✅ Вы зарегистрированы!\nТелефон: ${pendingLogin.phone}`, {
            reply_markup: mainKeyboard(),
          });
        } else {
          await bot.sendMessage(chatId, '❌ Не удалось зарегистрироваться. Попробуйте /login снова.');
        }
      } catch (err) {
        const message = err.response?.data?.message || err.message || 'Ошибка регистрации';
        await bot.sendMessage(chatId, `❌ ${message}\nПопробуйте /login снова.`);
      }
      return;
    }
    if (pendingLogin) return; // в процессе входа (ждём контакт)
  });

  // ——— Кнопки и спин ———
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = (msg.text || '').trim();
    if (msg.contact) return; // контакт — отдельный обработчик
    const pendingLogin = store.getPendingLogin(chatId);
    if (pendingLogin) return; // в процессе входа

    // Кнопка «Мой баланс»
    if (text === '💰 Мой баланс') {
      await sendBalance(bot, chatId, userId);
      return;
    }
    // Кнопка «Крутить рулетку» — запрашиваем только геолокацию
    if (text === '🎰 Крутить рулетку') {
      const token = store.getToken(userId);
      if (!token) {
        await bot.sendMessage(chatId, 'Сначала войдите: /login');
        return;
      }
      store.setPendingSpin(chatId);
      await bot.sendMessage(chatId, 'Отправьте геолокацию, чтобы подтвердить нахождение в клубе:', {
        reply_markup: {
          keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }
    // Кнопка «Мой профиль»
    if (text === '👤 Мой профиль') {
      await sendProfile(bot, chatId, userId);
      return;
    }
  });

  // ——— /start ———
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);

    const lines = [
      '👋 Добро пожаловать в бот клуба!',
      '',
      token
        ? 'Вы авторизованы. Используйте кнопки ниже или команды.'
        : 'Для доступа к балансу и рулетке нужно войти.',
      '',
      '📱 /login — войти',
      '💰 /balance — баланс',
      '🎰 /spin — крутить рулетку (отправьте геолокацию)',
      '👤 /profile — мой профиль',
      '🎁 /prizes — мои призы',
      '📜 /history — история',
      '🏆 /recent — последние выигрыши',
      '🚪 /logout — выйти',
    ];
    await bot.sendMessage(chatId, lines.join('\n'), {
      reply_markup: token ? mainKeyboard() : undefined,
    });
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

  // ——— /spin — запрашиваем только геолокацию
  bot.onText(/\/spin$/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);
    if (!token) {
      await bot.sendMessage(chatId, 'Сначала войдите: /login');
      return;
    }
    store.setPendingSpin(chatId);
    await bot.sendMessage(chatId, 'Отправьте геолокацию, чтобы подтвердить нахождение в клубе:', {
      reply_markup: {
        keyboard: [[{ text: '📍 Отправить геолокацию', request_location: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
  });

  // ——— /prizes ———
  bot.onText(/\/(prizes|призы)/i, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const token = store.getToken(userId);
    if (!token) {
      await bot.sendMessage(chatId, 'Сначала войдите: /login');
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
      await bot.sendMessage(chatId, 'Сначала войдите: /login');
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
