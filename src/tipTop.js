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

export async function createTipTopPayment({ amount, externalId, packageId, points }) {
  if (!TIP_TOP_API_KEY) throw new Error('Не задан TIP_TOP_API_KEY');
  const notification_url = resolveNotificationUrl();
  const payload = {
    amount: Number(amount),
    currency: 'KZT',
    externalId: String(externalId),
    notification_url,
    description: `TopUp ${packageId}`,
    metadata: { packageId, points },
  };

  const { data } = await axios.post(`${TIP_TOP_API_URL.replace(/\/+$/, '')}/payments`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TIP_TOP_API_KEY}`,
    },
    timeout: 20000,
  });

  const paymentUrl = extractPaymentUrl(data);
  if (!paymentUrl) throw new Error('TipTop не вернул payment_url');
  return {
    paymentUrl,
    paymentId: extractPaymentId(data),
    raw: data,
  };
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

