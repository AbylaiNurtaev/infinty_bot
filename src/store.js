import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'store.json');

/** telegramUserId -> { token, phone? } */
let tokens = {};
/** chatId -> { step: 'await_code', phone: string } для сценария входа */
let pendingLogin = {};
/** chatId -> true когда ждём код клуба для спина */
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

  getPendingSpin(chatId) {
    return !!pendingSpin[chatId];
  },

  clearPendingSpin(chatId) {
    delete pendingSpin[chatId];
  },
};
