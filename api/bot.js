// telegram-bot.js
// Full Port of WhatsApp bot (wpp-bot.js) to Telegram using node-telegram-bot-api

import { Telegraf } from 'telegraf';
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

const bot = new Telegraf(TELEGRAM_TOKEN);

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
  if (request.method === 'POST') {
    try {
      await bot.handleUpdate(request.body, response);
    } catch (err) {
      console.error('Error handling update', err);
      response.status(500).send('Error handling update');
    }
  } else {
    response.status(200).send('OK');
  }
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

// Define your bot commands here
bot.command('start', (ctx) => ctx.reply('Welcome to the Telegram bot!'));
bot.command('ping', (ctx) => ctx.reply('🏓 Pong!'));
bot.on('text', (ctx) => ctx.reply(`Echo: ${ctx.message.text}`));

// Handle webhook updates
bot.telegram.setWebhook(`${VERCEL_URL}/api/bot`);

// Register command handlers
bot.command('status', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Please provide a truck number: /status <truckNo>');
  }
  
  const truck = args.slice(1).join(' ');
  try {
    const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    let reply = `🚚 *Truck Info for ${truck}*\n`;
    for (let [k, v] of Object.entries(details)) {
      reply += `\n*${k}*: ${v}`;
    }
    await ctx.replyWithMarkdown(reply);
  } catch (err) {
    await ctx.reply(`❌ Error: ${err.message}`);
    await notifyAdmin(`Error fetching status for ${truck}: ${err.message}`);
  }
});

bot.command('row', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2 || isNaN(parseInt(args[1]))) {
    return ctx.reply('Please provide a row number: /row <rowNo>');
  }
  
  const row = parseInt(args[1]);
  try {
    const url = `${SCRIPT_URL}?action=getRowDetails&sheet=TRANSIT&query=${row}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    const pdfBuffer = await generatePDF(details);

    // Send PDF as document
    await ctx.replyWithDocument({ source: pdfBuffer, filename: `Row${row}-Report.pdf` });
  } catch (err) {
    await ctx.reply(`⚠️ PDF Generation Failed: ${err.message}`);
    await notifyAdmin(`Error fetching row ${row}: ${err.message}`);
  }
});

bot.command('report', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Please provide a truck number: /report <truckNo>');
  }
  
  const truck = args.slice(1).join(' ');
  try {
    const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
    const res = await fetch(url);
    const json = await res.json();
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

    await ctx.replyWithMarkdown(`📧 Email sent with report for *${truck}*`);
  } catch (err) {
    await ctx.reply(`❌ Email Failed: ${err.message}`);
    await notifyAdmin(`Error emailing report for ${truck}: ${err.message}`);
  }
});

// Handle unknown commands or messages
bot.on('text', (ctx) => {
  ctx.reply(`❓ Unknown input. Use /status <truck> or /row <rowNo>`);
});
