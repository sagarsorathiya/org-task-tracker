// ──────────────────────────────────────────────
// WhatsApp via WAHA — HTTP API Wrapper
// ──────────────────────────────────────────────

import { logger } from './logger';
import type { Task } from '@/types';

export async function sendWhatsAppReminder(
  phoneNumber: string,
  task: Pick<Task, 'id' | 'title' | 'due_date'>
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = process.env.WAHA_BASE_URL;
  const session = process.env.WAHA_SESSION || 'default';
  const apiKey = process.env.WAHA_API_KEY;

  if (!baseUrl) {
    return { success: false, error: 'WAHA not configured' };
  }

  if (!phoneNumber || !phoneNumber.trim()) {
    return { success: false, error: 'No phone number for user' };
  }

  try {
    const portalUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const message = [
      `📋 *Task Reminder*`,
      ``,
      `*${task.title}*`,
      `Due Date: ${task.due_date || 'Not set'}`,
      ``,
      `View: ${portalUrl}/tasks/${task.id}`,
      ``,
      `— Organization Activity Tracker`,
    ].join('\n');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        session,
        chatId: `${phoneNumber.replace(/\D/g, '')}@c.us`,
        text: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, errorText, taskId: task.id }, 'WAHA API error');
      return { success: false, error: `WAHA API error: ${response.status}` };
    }

    logger.info({ taskId: task.id, phoneNumber: phoneNumber.replace(/.(?=.{4})/g, '*') }, 'WhatsApp reminder sent');
    return { success: true };
  } catch (err) {
    logger.error({ err, taskId: task.id }, 'Failed to send WhatsApp reminder');
    return { success: false, error: String(err) };
  }
}
