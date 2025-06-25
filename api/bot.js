// telegram-bot.js
// Full Port of WhatsApp bot (wpp-bot.js) to Telegram using node-telegram-bot-api

import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// === CONFIG ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SCRIPT_URL = process.env.SCRIPT_URL;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const VERCEL_URL = process.env.VERCEL_URL; // e.g. https://your-app.vercel.app

// === Email Transport ===
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

// === HELPERS ===
function generatePDF(data, filename = 'report.pdf') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(14).text('Repair Report', { align: 'center' });
    doc.moveDown();
    Object.entries(data).forEach(([key, val]) => {
      doc.text(`${key}: ${val}`);
    });
    doc.end();
  });
}

async function notifyAdmin(msg) {
  // Optionally send a message to admin via Telegram API
  if (ADMIN_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: `[ADMIN NOTICE]\n${msg}` }),
    });
  }
}

// === MAIN HANDLER ===
export default async function handler(request, response) {
  // Node.js API: request.headers is an object, not a Map
  const host = request.headers['host'] || request.headers.host;
  const protocol = host && host.startsWith('localhost') ? 'http' : 'https';
  const absUrl = request.url.startsWith('http')
    ? request.url
    : `${protocol}://${host}${request.url}`;
  const { pathname, searchParams } = new URL(absUrl);
  const hasSetWebhookQuery =
    searchParams.has('setwebhook') ||
    pathname.endsWith('/setwebhook');

  if (
    request.method === 'GET' &&
    (
      pathname.startsWith('/setwebhook') ||
      hasSetWebhookQuery
    )
  ) {
    if (!VERCEL_URL) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'VERCEL_URL env var required' }));
      return;
    }
    const webhookUrl = `${VERCEL_URL}/api/bot.js`;
    const setWebhookRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      }
    );
    const data = await setWebhookRes.json();
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ setWebhook: data, webhookUrl }));
    return;
  }

  // Only accept POST requests from Telegram
  if (request.method !== 'POST') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 'ok', message: 'Send Telegram webhook updates via POST.' }));
    return;
  }

  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', async () => {
    try {
      body = body ? JSON.parse(body) : {};
    } catch (e) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // === Handle Telegram update ===
    try {
      const message = body.message;
      if (!message || !message.text) {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ status: 'ignored' }));
        return;
      }
      const chatId = message.chat.id;
      const text = message.text.trim();

      // === Command Handlers ===
      if (/^\/start/.test(text)) {
        await sendMessage(chatId, 'Welcome to the Truck Bot 🚛\nUse /status <truckNo> or /row <rowNo>');
      } else if (/^\/status (.+)/.test(text)) {
        const truck = text.match(/^\/status (.+)/)[1];
        try {
          const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
          const res2 = await fetch(url);
          const json = await res2.json();
          if (!json.success) throw new Error(json.message);

          const details = json.data[0];
          let reply = `🚚 *Truck Info for ${truck}*\n`;
          for (let [k, v] of Object.entries(details)) {
            reply += `\n*${k}*: ${v}`;
          }
          await sendMessage(chatId, reply, 'Markdown');
        } catch (err) {
          await sendMessage(chatId, `❌ Error: ${err.message}`);
          await notifyAdmin(`Error fetching status for ${truck}: ${err.message}`);
        }
      } else if (/^\/row (\d+)/.test(text)) {
        const row = parseInt(text.match(/^\/row (\d+)/)[1]);
        try {
          const url = `${SCRIPT_URL}?action=getRowDetails&sheet=TRANSIT&query=${row}`;
          const res2 = await fetch(url);
          const json = await res2.json();
          if (!json.success) throw new Error(json.message);

          const details = json.data[0];
          const pdfBuffer = await generatePDF(details);

          // Send PDF as document
          await sendDocument(chatId, pdfBuffer, `Row${row}-Report.pdf`);
        } catch (err) {
          await sendMessage(chatId, `⚠️ PDF Generation Failed: ${err.message}`);
          await notifyAdmin(`Error fetching row ${row}: ${err.message}`);
        }
      } else if (/^\/report (.+)/.test(text)) {
        const truck = text.match(/^\/report (.+)/)[1];
        try {
          const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
          const res2 = await fetch(url);
          const json = await res2.json();
          if (!json.success) throw new Error(json.message);

          const details = json.data[0];
          const pdfBuffer = await generatePDF(details);

          await transporter.sendMail({
            from: SMTP_USER,
            to: 'recipient@example.com',
            subject: `Repair Report - ${truck}`,
            text: 'Attached is the repair report.',
            attachments: [{ filename: `${truck}.pdf`, content: pdfBuffer }],
          });

          await sendMessage(chatId, `📧 Email sent with report for *${truck}*`, 'Markdown');
        } catch (err) {
          await sendMessage(chatId, `❌ Email Failed: ${err.message}`);
          await notifyAdmin(`Error emailing report for ${truck}: ${err.message}`);
        }
      } else {
        await sendMessage(chatId, `❓ Unknown input. Use /status <truck> or /row <rowNo>`);
      }

      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ status: 'ok' }));
    } catch (err) {
      response.statusCode = 500;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: err.message }));
    }
  });
}

// === Telegram API helpers ===
async function sendMessage(chatId, text, parse_mode) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(parse_mode ? { parse_mode } : {}),
    }),
  });
}

async function sendDocument(chatId, buffer, filename) {
  // Telegram sendDocument via HTTP API with multipart/form-data
  // Use fetch + FormData (node-fetch v2 does not support FormData natively)
  // Use 'form-data' package for this in production, but here is a minimal workaround:
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('document', buffer, { filename });

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });
}
