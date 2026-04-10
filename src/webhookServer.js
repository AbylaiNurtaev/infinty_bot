import express from 'express';
import { applyLocalTopUpByPhone, getTopUpPackageByAmount, getTopUpPackageById } from './directTopUp.js';
import { store } from './store.js';
import { parseTipTopWebhook } from './tipTop.js';

const paidStatuses = new Set(['paid', 'success', 'succeeded']);

export function startWebhookServer(bot) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/webhook', async (req, res) => {
    try {
      const payload = req.body || {};
      const parsed = parseTipTopWebhook(payload);
      console.log('[tiptop:webhook] incoming', parsed);

      if (!paidStatuses.has(parsed.status)) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }

      if (!parsed.externalId) {
        res.status(400).json({ ok: false, error: 'externalId required' });
        return;
      }

      const pending = parsed.paymentId ? store.getPendingPayment(parsed.paymentId) : null;
      const pkg = (pending?.packageId && getTopUpPackageById(pending.packageId))
        || (parsed.packageId && getTopUpPackageById(parsed.packageId))
        || (parsed.amount != null && getTopUpPackageByAmount(parsed.amount));

      if (!pkg) {
        res.status(400).json({ ok: false, error: 'package not resolved' });
        return;
      }

      const topup = await applyLocalTopUpByPhone(parsed.externalId, pkg.id);
      if (parsed.paymentId) store.clearPendingPayment(parsed.paymentId);

      const telegramUserId = pending?.userId || store.findTelegramUserIdByPhone(parsed.externalId);
      const chatId = pending?.chatId || telegramUserId;
      if (chatId) {
        await bot.sendMessage(
          Number(chatId),
          `✅ Оплата подтверждена.\n🎁 Начислено: +${topup.pointsAdded} баллов\n💰 Новый баланс: ${topup.newBalance} баллов.`
        );
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[tiptop:webhook] error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const port = Number(process.env.PORT || process.env.WEBHOOK_PORT || 8787);
  app.listen(port, () => {
    console.log(`[tiptop:webhook] server started on :${port}, path /webhook`);
  });
}

