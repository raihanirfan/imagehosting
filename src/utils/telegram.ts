import { Env } from '../types';

export async function notifyTelegram(env: Env, text: string): Promise<void> {
    const token = (env as any).TELEGRAM_BOT_TOKEN as string | undefined;
    const chatId = (env as any).TELEGRAM_CHAT_ID as string | undefined;
    if (!token || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
    } catch (e) { console.error('telegram notify failed', e); }
}
