// telegram-bot.js
// Full Port of WhatsApp bot (wpp-bot.js) to Telegram using node-telegram-bot-api

import TelegramBot from 'node-telegram-bot-api';
import fetch from 'node-fetch';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

// === CONFIG ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // BotFather Token
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;   // Your Telegram ID
const SCRIPT_URL = process.env.SCRIPT_URL;         // Google Apps Script endpoint
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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

function notifyAdmin(msg) {
  bot.sendMessage(ADMIN_CHAT_ID, `[ADMIN NOTICE]\n${msg}`);
}

// === BOT COMMANDS ===
bot.onText(/^\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to the Truck Bot 🚛\nUse /status <truckNo> or /row <rowNo>');
});

bot.onText(/^\/status (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const truck = match[1];
  try {
    const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    let text = `🚚 *Truck Info for ${truck}*\n`;
    for (let [k, v] of Object.entries(details)) {
      text += `\n*${k}*: ${v}`;
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    notifyAdmin(`Error fetching status for ${truck}: ${err.message}`);
  }
});

bot.onText(/^\/row (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const row = parseInt(match[1]);
  try {
    const url = `${SCRIPT_URL}?action=getRowDetails&sheet=TRANSIT&query=${row}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    const pdfBuffer = await generatePDF(details);
    bot.sendDocument(chatId, pdfBuffer, {}, { filename: `Row${row}-Report.pdf` });
  } catch (err) {
    bot.sendMessage(chatId, `⚠️ PDF Generation Failed: ${err.message}`);
    notifyAdmin(`Error fetching row ${row}: ${err.message}`);
  }
});

bot.onText(/^\/report (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const truck = match[1];
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

    bot.sendMessage(chatId, `📧 Email sent with report for *${truck}*`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Email Failed: ${err.message}`);
    notifyAdmin(`Error emailing report for ${truck}: ${err.message}`);
  }
});

// === FALLBACK ===
bot.on('message', (msg) => {
  const isCommand = /^\//.test(msg.text);
  if (!isCommand) {
    bot.sendMessage(msg.chat.id, `❓ Unknown input. Use /status <truck> or /row <rowNo>`);
  }
});
