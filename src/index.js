import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { registerHandlers } from './handlers.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Укажите TELEGRAM_BOT_TOKEN в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

registerHandlers(bot);

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('Бот запущен. Остановка: Ctrl+C');
