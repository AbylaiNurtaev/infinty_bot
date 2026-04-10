import axios from 'axios';

const TIP_TOP_API_URL = process.env.TIP_TOP_API_URL || 'https://api.tiptoppay.kz';
const TIP_TOP_API_KEY = process.env.TIP_TOP_API_KEY;

function resolveNotificationUrl() {
  const direct = process.env.TIP_TOP_WEBHOOK_URL;
  if (direct && String(direct).trim()) return String(direct).trim();
  const base = process.env.PUBLIC_BASE_URL;
  if (base && String(base).trim()) return `${String(base).replace(/\/+$/, '')}/webhook`;
  throw new Error('Не задан webhook URL: установите TIP_TOP_WEBHOOK_URL или PUBLIC_BASE_URL');
}

function extractPaymentUrl(data) {
  return (
    data?.payment_url ||
    data?.paymentUrl ||
    data?.checkout_url ||
    data?.checkoutUrl ||
    data?.url ||
    data?.model?.payment_url ||
    data?.model?.paymentUrl ||
    data?.model?.url ||
    data?.result?.payment_url ||
    data?.result?.paymentUrl ||
    data?.result?.url ||
    null
  );
}

function extractPaymentId(data) {
  return (
    data?.payment_id ||
    data?.paymentId ||
    data?.id ||
    data?.transaction_id ||
    data?.invoice_id ||
    data?.model?.id ||
    null
  );
}

function safeForLog(value) {
  try {
    const asString = JSON.stringify(value);
    if (!asString) return value;
    if (asString.length <= 3000) return value;
    return `${asString.slice(0, 3000)}...<truncated>`;
  } catch (_) {
    return String(value);
  }
}

export async function createTipTopPayment({ amount, externalId, packageId, points }) {
  if (!TIP_TOP_API_KEY) throw new Error('Не задан TIP_TOP_API_KEY');
  const notification_url = resolveNotificationUrl();
  const payloadCamel = {
    amount: Number(amount),
    currency: 'KZT',
    externalId: String(externalId),
    notification_url,
    description: `TopUp ${packageId}`,
    metadata: { packageId, points },
  };
  const payloadSnake = {
    amount: Number(amount),
    currency: 'KZT',
    external_id: String(externalId),
    notification_url,
    description: `TopUp ${packageId}`,
    metadata: { packageId, points },
  };

  const base = TIP_TOP_API_URL.replace(/\/+$/, '');
  const attempts = [
    {
      name: 'payments-bearer-camel',
      url: `${base}/payments`,
      payload: payloadCamel,
      headers: { Authorization: `Bearer ${TIP_TOP_API_KEY}` },
    },
    {
      name: 'payments-bearer-snake',
      url: `${base}/payments`,
      payload: payloadSnake,
      headers: { Authorization: `Bearer ${TIP_TOP_API_KEY}` },
    },
    {
      name: 'payments-x-api-key',
      url: `${base}/payments`,
      payload: payloadSnake,
      headers: { 'X-API-KEY': TIP_TOP_API_KEY },
    },
    {
      name: 'payment-links',
      url: `${base}/payment-links`,
      payload: payloadSnake,
      headers: { Authorization: `Bearer ${TIP_TOP_API_KEY}` },
    },
  ];

  const debug = [];
  for (const attempt of attempts) {
    try {
      const { data } = await axios.post(attempt.url, attempt.payload, {
        headers: {
          'Content-Type': 'application/json',
          ...attempt.headers,
        },
        timeout: 20000,
      });
      const paymentUrl = extractPaymentUrl(data);
      if (paymentUrl) {
        console.log('[tiptop] create payment success', JSON.stringify({
          attempt: attempt.name,
          url: attempt.url,
          externalId: String(externalId),
          amount: Number(amount),
          responseData: safeForLog(data),
        }, null, 2));
        return {
          paymentUrl,
          paymentId: extractPaymentId(data),
          raw: data,
        };
      }
      debug.push({
        attempt: attempt.name,
        ok: true,
        keys: Object.keys(data || {}),
        responseData: safeForLog(data),
      });
    } catch (err) {
      debug.push({
        attempt: attempt.name,
        ok: false,
        status: err.response?.status,
        message: err.response?.data?.message || err.message,
        responseData: safeForLog(err.response?.data || null),
      });
    }
  }

  console.log('[tiptop] create payment failed', JSON.stringify({
    externalId: String(externalId),
    amount: Number(amount),
    notification_url,
    debug,
  }, null, 2));
  throw new Error('TipTop не вернул ссылку оплаты. Проверьте формат API/ключи (детали в логах сервера).');
}

export function parseTipTopWebhook(body) {
  const statusRaw =
    body?.status ||
    body?.payment_status ||
    body?.paymentStatus ||
    body?.event ||
    body?.model?.status ||
    '';
  const status = String(statusRaw).toLowerCase();
  const externalId =
    body?.externalId ||
    body?.external_id ||
    body?.model?.externalId ||
    body?.model?.external_id ||
    null;
  const amountRaw = body?.amount ?? body?.model?.amount ?? null;
  const amount = amountRaw == null ? null : Number(amountRaw);
  const packageId =
    body?.metadata?.packageId ||
    body?.model?.metadata?.packageId ||
    null;
  const paymentId =
    body?.payment_id ||
    body?.paymentId ||
    body?.id ||
    body?.model?.id ||
    null;

  return { status, externalId, amount, packageId, paymentId };
}

