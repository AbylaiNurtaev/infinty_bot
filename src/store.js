import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'store.json');

/** telegramUserId -> { token, phone? } */
let tokens = {};
/** chatId -> { step: 'await_code'|'await_name', phone?: string } для сценария входа/регистрации */
let pendingLogin = {};
/** chatId -> true когда ждём новое имя в профиле */
let pendingChangeName = {};
/** telegramUserId -> ref payload (например ref_12345) — пригласивший, сохраняется до первого логина/регистрации */
let referralPayloadByUser = {};
/** chatId -> true когда ждём ввод реферального кода (fallback, если по ссылке пришёл только /start) */
let awaitReferralCode = {};
/** userId -> { expiresAt, latitude, longitude } — гео-сессия 60 мин (в памяти) */
let geoSessions = {};
/** userId -> number[] — время последних спинов для лимита 5 за 10 мин */
let spinTimes = {};

function load() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    tokens = JSON.parse(raw);
  } catch (_) {
    tokens = {};
  }
}

function save() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (e) {
    console.error('store save error:', e.message);
  }
}

load();

export const store = {
  getToken(telegramUserId) {
    return tokens[String(telegramUserId)]?.token ?? null;
  },

  setToken(telegramUserId, token, phone) {
    tokens[String(telegramUserId)] = { token, phone: phone || tokens[String(telegramUserId)]?.phone };
    save();
  },

  removeToken(telegramUserId) {
    delete tokens[String(telegramUserId)];
    save();
  },

  setPendingLogin(chatId, phone) {
    pendingLogin[chatId] = { step: 'await_code', phone: phone ?? null };
  },

  /** После контакта: ждём имя для регистрации */
  setPendingLoginAwaitName(chatId, phone) {
    pendingLogin[chatId] = { step: 'await_name', phone };
  },

  getPendingLogin(chatId) {
    return pendingLogin[chatId] ?? null;
  },

  clearPendingLogin(chatId) {
    delete pendingLogin[chatId];
  },

  /** Гео-сессия: 60 минут с момента подтверждения клуба */
  setGeoSession(userId, latitude, longitude, durationMs = 60 * 60 * 1000) {
    geoSessions[String(userId)] = {
      expiresAt: Date.now() + durationMs,
      latitude,
      longitude,
    };
  },

  getGeoSession(userId) {
    const s = geoSessions[String(userId)];
    if (!s || s.expiresAt <= Date.now()) return null;
    return s;
  },

  clearGeoSession(userId) {
    delete geoSessions[String(userId)];
  },

  /** Лимит: не более 5 спинов за 10 минут */
  recordSpin(userId) {
    const key = String(userId);
    const now = Date.now();
    if (!spinTimes[key]) spinTimes[key] = [];
    spinTimes[key].push(now);
    const windowMs = 10 * 60 * 1000;
    spinTimes[key] = spinTimes[key].filter((t) => t > now - windowMs);
  },

  canSpin(userId) {
    const list = spinTimes[String(userId)] || [];
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const inWindow = list.filter((t) => t > now - windowMs);
    return inWindow.length < 5;
  },

  setPendingChangeName(chatId) {
    pendingChangeName[chatId] = true;
  },

  getPendingChangeName(chatId) {
    return !!pendingChangeName[chatId];
  },

  clearPendingChangeName(chatId) {
    delete pendingChangeName[chatId];
  },

  setReferralPayload(telegramUserId, payload) {
    if (payload && String(payload).trim()) referralPayloadByUser[String(telegramUserId)] = String(payload).trim();
  },

  getReferralPayload(telegramUserId) {
    return referralPayloadByUser[String(telegramUserId)] ?? null;
  },

  clearReferralPayload(telegramUserId) {
    delete referralPayloadByUser[String(telegramUserId)];
  },

  setAwaitReferralCode(chatId) {
    awaitReferralCode[chatId] = true;
  },
  getAwaitReferralCode(chatId) {
    return !!awaitReferralCode[chatId];
  },
  clearAwaitReferralCode(chatId) {
    delete awaitReferralCode[chatId];
  },
};
