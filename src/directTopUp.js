import { MongoClient } from 'mongodb';

const TOP_UP_PACKAGES = [
  { id: 'pack_50', points: 50, price: 500 },
  { id: 'pack_150', points: 150, price: 1200 },
  { id: 'pack_300', points: 300, price: 2000 },
];

let mongoClient = null;

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `7${digits.slice(-10)}`;
  return `7${digits.slice(-10)}`;
}

function getCollection() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('Не задан MONGO_URI');
  if (!mongoClient) mongoClient = new MongoClient(mongoUri);
  const dbName = process.env.MONGO_DB_NAME || 'test';
  const collectionName = process.env.MONGO_USERS_COLLECTION || 'users';
  return mongoClient.db(dbName).collection(collectionName);
}

async function ensureConnected() {
  if (!mongoClient) getCollection();
  await mongoClient.connect();
}

export function getLocalTopUpPackages() {
  return TOP_UP_PACKAGES;
}

export async function applyLocalTopUpByPhone(rawPhone, packageId) {
  const selected = TOP_UP_PACKAGES.find((p) => p.id === packageId);
  if (!selected) throw new Error('Пакет не найден');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('Не удалось определить номер пользователя');

  await ensureConnected();
  const users = getCollection();
  const query = {
    $or: [
      { phone },
      { phone: `+${phone}` },
      { phone: `8${phone.slice(1)}` },
      { phone: `+8${phone.slice(1)}` },
    ],
  };

  const res = await users.findOneAndUpdate(
    query,
    { $inc: { balance: selected.points } },
    { returnDocument: 'after' }
  );

  if (!res.value) throw new Error('Пользователь не найден в MongoDB (коллекция users)');
  return { pointsAdded: selected.points, newBalance: Number(res.value.balance || 0), packageId: selected.id };
}

