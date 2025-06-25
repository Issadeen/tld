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
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    // --- COLORS ---
    const colors = {
      primary: '#1a237e',
      secondary: '#303f9f',
      text: '#424242',
      light: '#e3f2fd',
      accent: '#ff9800',
      background: '#f9f9f9',
      border: '#9fa8da'
    };

    // --- HEADER ---
    doc.rect(40, 40, doc.page.width - 80, 60)
      .fillAndStroke('#f5f5ff', colors.primary)
      .stroke();
    doc.fontSize(18)
      .fillColor(colors.primary)
      .font('Helvetica-Bold')
      .text(process.env.COMPANY_NAME || 'Company', 55, 55);
    doc.fontSize(13)
      .fillColor(colors.secondary)
      .font('Helvetica-Bold')
      .text('TRUCK MAINTENANCE NOTIFICATION', 55, 80);

    // Registration highlight
    doc.save()
      .roundedRect(55, 105, 200, 22, 4)
      .fillAndStroke('#e3f2fd', colors.secondary)
      .restore();
    doc.fontSize(12)
      .fillColor(colors.secondary)
      .font('Helvetica-Bold')
      .text(data.reg_no || 'N/A', 60, 110);

    let y = 140;

    // --- VEHICLE & DRIVER DETAILS ---
    doc.fontSize(12)
      .fillColor(colors.primary)
      .font('Helvetica-Bold')
      .text('Vehicle & Driver Details', 55, y);
    y += 20;
    doc.moveTo(55, y).lineTo(doc.page.width - 55, y).strokeColor(colors.primary).lineWidth(1).stroke();
    y += 10;

    doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
    doc.text('Registration Number:', 55, y);
    doc.text('Entry Number:', 55, y + 18);
    doc.text("Driver's Name:", 300, y);
    doc.text('Mobile Number:', 300, y + 18);

    doc.font('Helvetica').fillColor(colors.text);
    doc.text(data.reg_no || 'N/A', 170, y);
    doc.text(data.entry_no || 'N/A', 170, y + 18);
    doc.text(data.driver_name || 'N/A', 400, y);
    doc.text(data.driver_no || 'N/A', 400, y + 18);

    y += 40;

    // --- MAINTENANCE INFORMATION ---
    doc.fontSize(12)
      .fillColor(colors.primary)
      .font('Helvetica-Bold')
      .text('Maintenance Information', 55, y);
    y += 20;
    doc.moveTo(55, y).lineTo(doc.page.width - 55, y).strokeColor(colors.primary).lineWidth(1).stroke();
    y += 10;

    doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
    doc.text('Location:', 55, y);
    doc.text('Site Details:', 55, y + 18);
    doc.text('Cargo Type:', 300, y);
    doc.text('Duration:', 300, y + 18);

    doc.font('Helvetica').fillColor(colors.text);
    doc.text(data.location || 'N/A', 120, y);
    doc.text('Along Uganda Road', 120, y + 18);
    doc.text('WET CARGO', 380, y);
    doc.save()
      .roundedRect(370, y + 18, 60, 16, 6)
      .fillAndStroke(data.duration === 48 ? '#ffecb3' : '#e3f2fd', data.duration === 48 ? '#ffb300' : '#1976d2')
      .restore();
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(data.duration === 48 ? '#bf360c' : '#0d47a1')
      .text(`${data.duration || 24} hours`, 380, y + 20);

    y += 40;

    // --- CONTACT INFORMATION ---
    doc.fontSize(12)
      .fillColor(colors.primary)
      .font('Helvetica-Bold')
      .text('Contact Information', 55, y);
    y += 20;
    doc.moveTo(55, y).lineTo(doc.page.width - 55, y).strokeColor(colors.primary).lineWidth(1).stroke();
    y += 10;

    doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
    doc.text('Email:', 55, y);

    doc.font('Helvetica').fillColor('#0d47a1');
    doc.text(data.email || 'N/A', 110, y, { underline: true });

    // --- FOOTER ---
    doc.fontSize(8)
      .fillColor('#777777')
      .text('This is an automatically generated report. Please contact support if you have any questions.',
        55, doc.page.height - 60, { align: 'center', width: doc.page.width - 110 });
    doc.fontSize(7.5)
      .fillColor('#AAAAAA')
      .text(`Generated on ${new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}`,
        55, doc.page.height - 45, { align: 'center', width: doc.page.width - 110 });

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
    let reply = `*Details for Row ${row}:*\n`;
    for (let [k, v] of Object.entries(details)) {
      reply += `*${k}*: ${v}\n`;
    }
    await ctx.replyWithMarkdown(reply);
  } catch (err) {
    await ctx.reply(`⚠️ Row Fetch Failed: ${err.message}`);
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
    let reply = `*Details for Row ${row}:*\n`;
    for (let [k, v] of Object.entries(details)) {
      reply += `*${k}*: ${v}\n`;
    }
    await ctx.replyWithMarkdown(reply);
  } catch (err) {
    await ctx.reply(`⚠️ Row Fetch Failed: ${err.message}`);
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
  // Improved email extraction: check all lines for the first valid email
  for (const line of lines) {
    // Check for key-value pairs like "key: value"
    const kvMatch = line.match(/^([a-zA-Z]+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      if (/^entry$/i.test(key)) data.entry_no = value;
      else if (/^hours$/i.test(key)) {
        const h = parseInt(value, 10);
        if (!isNaN(h) && [24, 48].includes(h)) data.duration = h;
      }
      else if (/^team$/i.test(key)) data.team = value || 'Eldoret';
    }
    // Check for email in any line
    else if (/@/.test(line) && !emailFound) {
      const match = line.match(/[A-Za-z0-9._%+-]+@[A-ZaZ0-9.-]+\.[A-Za-z]{2,}/);
      if (match) {
        data.email = match[0];
        emailFound = true;
      }
    }
  }

  // For testing: echo the parsed data
  ctx.reply(`Parsed data:\n\`\`\`${JSON.stringify(data, null, 2)}\n\`\`\``);
});

// === Vercel Webhook Handler ===
const handler = async (req, res) => {
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
};

export default handler;
