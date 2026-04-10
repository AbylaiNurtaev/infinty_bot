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
  return { collection: mongoClient.db(dbName).collection(collectionName), dbName, collectionName };
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
  const { collection: users, dbName, collectionName } = getCollection();
  const raw = String(rawPhone || '').trim();
  const plain8 = `8${phone.slice(1)}`;
  const variants = Array.from(new Set([
    phone,
    `+${phone}`,
    plain8,
    `+${plain8}`,
    raw,
  ].filter(Boolean)));
  const query = {
    $or: variants.map((v) => ({ phone: v })),
  };

  console.log('[topup] search user', {
    dbName,
    collectionName,
    rawPhone: raw,
    normalizedPhone: phone,
    variants,
  });

  const res = await users.findOneAndUpdate(
    query,
    { $inc: { balance: selected.points } },
    { returnDocument: 'after' }
  );

  if (!res.value) {
    const sample = await users.find({}, { projection: { _id: 0, phone: 1, balance: 1 } }).limit(5).toArray();
    console.log('[topup] user not found', { dbName, collectionName, variants, sample });
    throw new Error(
      `Пользователь не найден. Ищем в ${dbName}.${collectionName} по полю phone. Варианты: ${variants.join(', ')}`
    );
  }
  console.log('[topup] success', { userPhone: res.value.phone, pointsAdded: selected.points, newBalance: res.value.balance });
  return { pointsAdded: selected.points, newBalance: Number(res.value.balance || 0), packageId: selected.id };
}

