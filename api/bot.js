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
const VERCEL_URL = process.env.VERCEL_URL;

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
  if (ADMIN_CHAT_ID) {
    await bot.telegram.sendMessage(ADMIN_CHAT_ID, `[ADMIN NOTICE]\n${msg}`);
  }
}

// === COMMANDS ===
bot.start((ctx) =>
  ctx.reply('Welcome! Use /status <truckNo>, /row <rowNo>, /help, /format, /system, /testpdf, /newtruck')
);

bot.command('help', (ctx) =>
  ctx.reply(
    `*Welcome to Issaerium bot chat, a smart way of working!* 🤖

Commands:
$status <reg_no> - Check truck status
/row <row_no> - Get details for a specific row
/report <truckNo> - Email a repair report
/format - Show format instructions
/system - Show bot system status
/testpdf - Generate sample PDF
/newtruck - Guided truck entry wizard

Send plain text for maintenance/overnight/overstay reports.
`,
    { parse_mode: 'Markdown' }
  )
);

bot.command('format', (ctx) =>
  ctx.reply(
    `📝 *Maintenance Report Format*
Registration Number
Driver Name
Mobile Number
Location
[Your Email Address - anywhere in msg]
Optional: entry: [Entry Number], hours: [24 or 48], team: [Team Name]
Example:
KCC492P/ZG1633
YUSSUF MAALIM
0722809260
HASS PETROLEUM ELDORET DEPOT
driver@company.com
team: Nairobi
hours: 48
`,
    { parse_mode: 'Markdown' }
  )
);

bot.command('status', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Usage: /status <truckNo>');
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
    return ctx.reply('Usage: /row <rowNo>');
  }
  const row = parseInt(args[1]);
  try {
    const url = `${SCRIPT_URL}?action=getRowDetails&sheet=TRANSIT&query=${row}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    const pdfBuffer = await generatePDF(details);
    await ctx.replyWithDocument({ source: pdfBuffer, filename: `Row${row}-Report.pdf` });
  } catch (err) {
    await ctx.reply(`⚠️ PDF Generation Failed: ${err.message}`);
    await notifyAdmin(`Error fetching row ${row}: ${err.message}`);
  }
});

bot.command('report', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Usage: /report <truckNo>');
  const truck = args.slice(1).join(' ');
  try {
    const url = `${SCRIPT_URL}?action=getTruckStatus&sheet=TRANSIT&query=${encodeURIComponent(truck)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    const pdfBuffer = await generatePDF(details);

    // Send PDF to user first
    await ctx.replyWithDocument({ source: pdfBuffer, filename: `${truck}-Report.pdf` });

    // Then send email
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

bot.command('system', (ctx) =>
  ctx.reply('✅ Bot is running. All systems nominal.')
);

bot.command('testpdf', async (ctx) => {
  try {
    const details = {
      reg_no: 'KCC492P/ZG1633',
      driver_name: 'YUSSUF MAALIM',
      driver_no: '0722809260',
      location: 'HASS PETROLEUM ELDORET DEPOT',
      email: 'driver@company.com',
    };
    const pdfBuffer = await generatePDF(details);
    await ctx.replyWithDocument({ source: pdfBuffer, filename: 'Test-Repair-Report.pdf' });
  } catch (err) {
    await ctx.reply(`❌ PDF Generation Failed: ${err.message}`);
  }
});

// === Plain text handlers for "status <truckNo>" and "row <rowNo>" ===
bot.hears(/^status\s+(.+)/i, async (ctx) => {
  const truck = ctx.match[1].trim();
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

bot.hears(/^row\s+(\d+)/i, async (ctx) => {
  const row = parseInt(ctx.match[1]);
  try {
    const url = `${SCRIPT_URL}?action=getRowDetails&sheet=TRANSIT&query=${row}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const details = json.data[0];
    const pdfBuffer = await generatePDF(details);
    await ctx.replyWithDocument({ source: pdfBuffer, filename: `Row${row}-Report.pdf` });
  } catch (err) {
    await ctx.reply(`⚠️ PDF Generation Failed: ${err.message}`);
    await notifyAdmin(`Error fetching row ${row}: ${err.message}`);
  }
});

// === Default handler for plain text: treat as repair report ===
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  // Ignore if it matches a command or known pattern
  if (
    text.startsWith('/') ||
    /^status\s+/i.test(text) ||
    /^row\s+/i.test(text)
  ) {
    ctx.reply('❓ Unknown input. Use /status <truckNo> or /row <rowNo>');
    return;
  }

  // Parse repair report fields (Registration, Driver, Mobile, Location, Email, etc.)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const data = {
    reg_no: lines[0] || '',
    driver_name: lines[1] || '',
    driver_no: lines[2] || '',
    location: lines[3] || '',
    email: '',
    entry_no: null,
    duration: 24,
    team: 'Eldoret'
  };
  let emailFound = false;
  lines.forEach(line => {
    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^entry$/i.test(key)) data.entry_no = value;
    else if (/^hours$/i.test(key)) {
      const h = parseInt(value, 10);
      if (!isNaN(h) && [24, 48].includes(h)) data.duration = h;
    }
    else if (/^team$/i.test(key)) data.team = value || 'Eldoret';
    else if (/@/.test(line) && !emailFound) {
      const match = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-ZaZ]{2,}/);
      if (match) {
        data.email = match[0];
        emailFound = true;
      }
    }
  });

  // Validate required fields
  const missing = [];
  if (!data.reg_no) missing.push('Registration Number (first line)');
  if (!data.driver_name) missing.push('Driver Name (second line)');
  if (!data.driver_no) missing.push('Mobile Number (third line)');
  if (!data.location) missing.push('Location (fourth line)');
  if (!data.email) missing.push('A valid Email Address (anywhere in the message)');

  if (missing.length > 0) {
    await ctx.reply(`⚠️ Missing fields: ${missing.join(', ')}.\nPlease check the format using /format.`);
    return;
  }

  // Process as repair report
  try {
    await ctx.reply(`🛠️ Processing maintenance report for *${data.reg_no}*...`, { parse_mode: 'Markdown' });
    const pdfBuffer = await generatePDF(data);
    await ctx.replyWithDocument({ source: pdfBuffer, filename: `RepairReport-${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}.pdf` });

    // Send email
    await transporter.sendMail({
      from: SMTP_USER,
      to: data.email,
      subject: `Truck Maintenance Notification: ${data.reg_no}`,
      text: `Maintenance report for ${data.reg_no}`,
      attachments: [{ filename: `RepairReport-${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, content: pdfBuffer }],
    });

    await ctx.reply(`📧 Email sent with PDF to: ${data.email}`);
    await notifyAdmin(`Maintenance report processed for ${data.reg_no}. User: ${ctx.from.id}`);
  } catch (err) {
    await ctx.reply(`❌ Error processing maintenance report: ${err.message}`);
    await notifyAdmin(`Error processing repair report for ${data.reg_no}: ${err.message}`);
  }
});

// === Vercel Webhook Handler ===
export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body, res);
    } catch (err) {
      console.error('Error handling update', err);
      res.status(500).send('Error handling update');
    }
  } else {
    res.status(200).send('OK');
  }
}
