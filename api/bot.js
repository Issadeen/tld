// telegram-bot.js
// Full Port of WhatsApp bot (wpp-bot.js) to Telegram using node-telegram-bot-api

import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import qrcode from 'qrcode';  // Add this import at the top
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
function getNairobiTimeString(type = 'date') {
  const now = new Date();
  const options = { timeZone: 'Africa/Nairobi' };
  if (type === 'datetime') {
    options.year = 'numeric';
    options.month = '2-digit';
    options.day = '2-digit';
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
    options.hour12 = false;
    return now.toLocaleString('en-GB', options);
  } else {
    options.year = 'numeric';
    options.month = 'long';
    options.day = 'numeric';
    return now.toLocaleDateString('en-GB', options);
  }
}

function createRepairEmailBody(data) {
  const entryInfo = data.entry_no ? `\n• Entry Number: ${data.entry_no}` : "";
  const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi' });
  return `Date: ${dateStr}\n\nDear RRU Team ${data.team || 'Eldoret'},\n\nTRUCK MAINTENANCE NOTIFICATION - ${data.reg_no}\n\nThe truck below has developed a mechanical problem and will be undergoing repairs.\n\nVehicle & Driver Details:\n----------------------\n• Registration Number: ${data.reg_no}${entryInfo}\n• Driver's Name: ${data.driver_name}\n• Mobile Number: ${data.driver_no}\n\nMaintenance Information:\n---------------------\n• Location: ${data.location}\n• Site Details: Along Uganda Road\n• Cargo Type: WET CARGO\n• Expected Duration: ${data.duration || 24} hours\n\nThank you for your attention to this matter.`;
}

function generatePDF(data, filename = 'report.pdf') {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true, autoFirstPage: false });
      doc.addPage();
      const chunks = [];
      const dateStr = getNairobiTimeString();
      const dateTimeStr = getNairobiTimeString('datetime');

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // === COLORS ===
      const colors = {
        primary: '#1a237e',
        secondary: '#303f9f',
        text: '#424242',
        light: '#e3f2fd',
        accent: '#ff9800',
        background: '#f9f9f9',
        border: '#9fa8da'
      };

      // === Add text watermark ===
      try {
        doc.save();
        const centerX = doc.page.width / 2;
        const centerY = doc.page.height / 2;
        doc.fillColor('#f0f0f0')
           .fontSize(78)
           .opacity(0.13)
           .rotate(-40, { origin: [centerX, centerY] })
           .text('URGENT REPAIR', 0, centerY, { align: 'center', width: doc.page.width });
        doc.restore();
      } catch (e) {
        console.error("Error drawing watermark:", e);
      }

      // === HEADER ===
      let currentY = doc.page.margins.top;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Header box
      doc.rect(doc.page.margins.left, currentY, pageWidth, 80)
         .fillAndStroke('#f5f5ff', colors.primary)
         .stroke();

      // Logo placement (if available)
      if (process.env.LOGO_IMAGE_URL) {
        try {
          const logoSize = 60;
          doc.image(process.env.LOGO_IMAGE_URL, doc.page.margins.left + 15, currentY + 10, {
            fit: [logoSize, logoSize],
            align: 'left'
          });
        } catch (logoErr) {
          console.error("Error placing logo in PDF:", logoErr);
        }
      }

      // Company name and report title
      const titleX = process.env.LOGO_IMAGE_URL ? doc.page.margins.left + 90 : doc.page.margins.left + 15;
      doc.fontSize(18)
         .fillColor(colors.primary)
         .font('Helvetica-Bold')
         .text(process.env.COMPANY_NAME || 'Company', titleX, currentY + 15);

      doc.fontSize(14)
         .fillColor(colors.secondary)
         .text('TRUCK MAINTENANCE NOTIFICATION', titleX, currentY + 35);

      // Registration highlight
      doc.save()
         .roundedRect(titleX, currentY + 55, 180, 20, 4)
         .fillAndStroke('#e3f2fd', colors.secondary);
      doc.fillColor(colors.secondary)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text(data.reg_no, titleX + 5, currentY + 58);
      doc.restore();

      currentY += 100;

      // --- VEHICLE & DRIVER DETAILS ---
      doc.fontSize(12)
        .fillColor(colors.primary)
        .font('Helvetica-Bold')
        .text('Vehicle & Driver Details', 55, currentY);
      currentY += 20;
      doc.moveTo(55, currentY).lineTo(doc.page.width - 55, currentY).strokeColor(colors.primary).lineWidth(1).stroke();
      currentY += 10;

      doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
      doc.text('Registration Number:', 55, currentY);
      doc.text('Entry Number:', 55, currentY + 18);
      doc.text("Driver's Name:", 300, currentY);
      doc.text('Mobile Number:', 300, currentY + 18);

      doc.font('Helvetica').fillColor(colors.text);
      doc.text(data.reg_no || 'N/A', 170, currentY);
      doc.text(data.entry_no || 'N/A', 170, currentY + 18);
      doc.text(data.driver_name || 'N/A', 400, currentY);
      doc.text(data.driver_no || 'N/A', 400, currentY + 18);

      currentY += 40;

      // --- MAINTENANCE INFORMATION ---
      doc.fontSize(12)
        .fillColor(colors.primary)
        .font('Helvetica-Bold')
        .text('Maintenance Information', 55, currentY);
      currentY += 20;
      doc.moveTo(55, currentY).lineTo(doc.page.width - 55, currentY).strokeColor(colors.primary).lineWidth(1).stroke();
      currentY += 10;

      doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
      doc.text('Location:', 55, currentY);
      doc.text('Site Details:', 55, currentY + 18);
      doc.text('Cargo Type:', 300, currentY);
      doc.text('Duration:', 300, currentY + 18);

      doc.font('Helvetica').fillColor(colors.text);
      doc.text(data.location || 'N/A', 120, currentY);
      doc.text('Along Uganda Road', 120, currentY + 18);
      doc.text('WET CARGO', 380, currentY);
      doc.save()
        .roundedRect(370, currentY + 18, 60, 16, 6)
        .fillAndStroke(data.duration === 48 ? '#ffecb3' : '#e3f2fd', data.duration === 48 ? '#ffb300' : '#1976d2')
        .restore();
      doc.font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(data.duration === 48 ? '#bf360c' : '#0d47a1')
        .text(`${data.duration || 24} hours`, 380, currentY + 20);

      currentY += 40;

      // --- CONTACT INFORMATION ---
      doc.fontSize(12)
        .fillColor(colors.primary)
        .font('Helvetica-Bold')
        .text('Contact Information', 55, currentY);
      currentY += 20;
      doc.moveTo(55, currentY).lineTo(doc.page.width - 55, currentY).strokeColor(colors.primary).lineWidth(1).stroke();
      currentY += 10;

      doc.fontSize(10).fillColor(colors.secondary).font('Helvetica-Bold');
      doc.text('Email:', 55, currentY);

      doc.font('Helvetica').fillColor('#0d47a1');
      doc.text(data.email || 'N/A', 110, currentY, { underline: true });

      // === FOOTER ===
      doc.fontSize(8)
         .fillColor('#777777')
         .text('This is an automatically generated report. Please contact support if you have any questions.',
           55, doc.page.height - 60, { align: 'center', width: doc.page.width - 110 });
      doc.fontSize(7.5)
         .fillColor('#AAAAAA')
         .text(`Generated on ${dateTimeStr}`,
           55, doc.page.height - 45, { align: 'center', width: doc.page.width - 110 });

      // === QR CODE Generation ===
      let qrCodeData = null;
      const qrCodeText = `REPAIR\nReg: ${data.reg_no}\nTeam: ${data.team || 'Eldoret'}\nLoc: ${data.location || 'N/A'}\nTime: ${dateTimeStr}`;
      try {
        qrCodeData = await qrcode.toBuffer(qrCodeText, {
          errorCorrectionLevel: 'M',
          type: 'png',
          margin: 1,
          scale: 4
        });
        console.log('QR Code generated successfully');
      } catch (qrError) {
        console.error("Error generating QR Code:", qrError);
      }

      // Place QR Code in top right corner
      if (qrCodeData) {
        const qrSize = 60;
        const qrX = doc.page.width - doc.page.margins.right - qrSize - 10;
        const qrY = doc.page.margins.top + 10;
        doc.image(qrCodeData, qrX, qrY, { 
          fit: [qrSize, qrSize],
          align: 'right'
        });

        // Add "Scan for details" text under QR
        doc.fontSize(8)
           .fillColor('#666666')
           .text('Scan for details', qrX, qrY + qrSize + 5, {
             width: qrSize,
             align: 'center'
           });
      }

      doc.end();

    } catch (err) {
      reject(err);
    }
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
            const match = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
            if (match) {
              data.email = match[0];
              emailFound = true;
            }
          }
        }
        
        // Continue with processing the repair report
        try {
          // Generate email body
          const emailBody = createRepairEmailBody(data);
          
          // Generate PDF
          const pdfBuffer = await generatePDF(data);
          
          // Send PDF to user
          await ctx.replyWithDocument({ source: pdfBuffer, filename: `${data.reg_no}-Report.pdf` });
          
          // Send email if we have an email address
          if (data.email) {
            await transporter.sendMail({
              from: SMTP_USER,
              to: data.email,
              subject: `Repair Report - ${data.reg_no}`,
              text: emailBody,
              attachments: [{ filename: `${data.reg_no}.pdf`, content: pdfBuffer }],
            });
            
            await ctx.replyWithMarkdown(`📧 Email sent to ${data.email} for *${data.reg_no}*`);
          } else {
            await ctx.reply("Report created but no email address found to send to.");
          }
        } catch (err) {
          await ctx.reply(`❌ Report Generation Failed: ${err.message}`);
          await notifyAdmin(`Error creating repair report: ${err.message}`);
        }
      });
      
      // Launch bot
      bot.launch().then(() => {
        console.log('Bot started successfully');
      }).catch(err => {
        console.error('Error starting bot:', err);
      });
      
      // Enable graceful stop
      process.once('SIGINT', () => bot.stop('SIGINT'));
      process.once('SIGTERM', () => bot.stop('SIGTERM'));
      
      export default bot;
