import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'https://club-back-production.up.railway.app/api';

/**
 * Клиент к бэкенду (те же эндпоинты, что на фронте).
 * Токен передаётся явно в каждом запросе (для игрока).
 */
export function createApiClient(token = null) {
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: { 'Content-Type': 'application/json' },
  });

  if (token) {
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  return {
    /** POST /auth/login — единый вход (игрок/клуб/админ), возвращает token + role. ref — реферальный код пригласившего (ref_<userId>). */
    async login(phone, code, ref = null) {
      const body = { phone: phone.trim(), code: code.trim() };
      if (ref && String(ref).trim()) body.ref = String(ref).trim();
      const { data } = await client.post('/auth/login', body);
      return data;
    },

    /** POST /auth/register — регистрация игрока (обязательно name). ref — реферальный код из start (ref_...). */
    async register(phone, code, name, ref = null) {
      const body = {
        phone: phone.trim(),
        code: code.trim(),
        name: (name || '').trim(),
      };
      if (ref && String(ref).trim()) body.ref = String(ref).trim();
      const { data } = await client.post('/auth/register', body);
      return data;
    },

    /** GET /players/me — текущий игрок (нужен token) */
    async getPlayerMe() {
      const { data } = await client.get('/players/me');
      return data;
    },

    /** PATCH /players/me — обновить имя. Тело: { "name": "Новое имя" }, заголовок Authorization: Bearer <token> */
    async updatePlayerMe({ name }) {
      const { data } = await client.patch('/players/me', { name: (name || '').trim() });
      return data;
    },

    /** GET /players/balance */
    async getPlayerBalance() {
      const { data } = await client.get('/players/balance');
      return data;
    },

    /** GET /players/transactions */
    async getPlayerTransactions() {
      const { data } = await client.get('/players/transactions');
      return data;
    },

    /** GET /players/prizes */
    async getPlayerPrizes() {
      const { data } = await client.get('/players/prizes');
      return data;
    },

    /** GET /players/club?club=CODE — клуб по коду/QR/clubId (публичный) */
    async getClub(club) {
      const { data } = await client.get('/players/club', { params: { club: club.trim() } });
      return data;
    },

    /** POST /players/spin — крутить рулетку (token, latitude, longitude). clubId из env CLUB_ID если задан. */
    async spinRoulette(latitude, longitude) {
      const body = {
        latitude: Number(latitude),
        longitude: Number(longitude),
      };
      const clubId = process.env.CLUB_ID?.trim();
      if (clubId) body.clubId = clubId;
      const { data } = await client.post('/players/spin', body);
      return data;
    },

    /** POST /players/spin-by-phone — крутить по телефону. При геолокации клуба — latitude, longitude. */
    async spinByPhone(clubId, phone, latitude, longitude) {
      const body = { clubId: clubId.trim(), phone: phone.trim() };
      if (latitude != null && longitude != null) {
        body.latitude = Number(latitude);
        body.longitude = Number(longitude);
      }
      const { data } = await client.post('/players/spin-by-phone', body);
      return data;
    },

    /** GET /players/recent-wins — последние выигрыши (публичный) */
    async getRecentWins() {
      const { data } = await client.get('/players/recent-wins');
      return Array.isArray(data) ? data : [];
    },
  };
}

export const api = createApiClient();
