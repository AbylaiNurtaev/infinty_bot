import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'store.json');

/** telegramUserId -> { token, phone? } */
let tokens = {};
/** chatId -> { step: 'await_code', phone: string } для сценария входа */
let pendingLogin = {};
/** chatId -> true когда ждём код клуба, или { clubId } когда ждём геолокацию для спина */
let pendingSpin = {};

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
    pendingLogin[chatId] = { step: 'await_code', phone };
  },

  getPendingLogin(chatId) {
    return pendingLogin[chatId] ?? null;
  },

  clearPendingLogin(chatId) {
    delete pendingLogin[chatId];
  },

  setPendingSpin(chatId) {
    pendingSpin[chatId] = true;
  },

  /** После ввода кода клуба — ждём геолокацию */
  setPendingSpinLocation(chatId, clubId) {
    pendingSpin[chatId] = { clubId };
  },

  getPendingSpin(chatId) {
    return pendingSpin[chatId] ?? null;
  },

  /** true — ждём код, иначе объект { clubId } — ждём геолокацию */
  isPendingSpinCode(chatId) {
    const v = pendingSpin[chatId];
    return v === true;
  },

  isPendingSpinLocation(chatId) {
    const v = pendingSpin[chatId];
    return v && typeof v === 'object' && v.clubId;
  },

  clearPendingSpin(chatId) {
    delete pendingSpin[chatId];
  },
};
