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

// Add these missing environment variables
const TANKER_IMAGE_URL = process.env.TANKER_IMAGE_URL;
const LOGO_IMAGE_URL = process.env.LOGO_IMAGE_URL;
const COMPANY_NAME = process.env.COMPANY_NAME || "IA";
const DEFAULT_RECIPIENTS = (process.env.DEFAULT_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);

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
// Add a new helper to fetch images from URLs
async function fetchImageFromUrl(url) {
  if (!url) return null;
  try {
    console.log(`Fetching image from URL: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    return await response.buffer();
  } catch (error) {
    console.error(`Error fetching image from URL: ${error.message}`);
    return null;
  }
}

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

// --- PDF Generation Function (with QR Code and Remote Watermark) ---
async function generateReportPdf(data, reportType) {
    // --- Implementation copied from backupd.js ---
    console.log(`[PDF Gen Start] Type: ${reportType}, ID: ${(reportType === 'repair' ? data.reg_no : data.omc_name) || 'N/A'}`); // Added logging
    const generationTimeout = 20000; // Increased timeout for network fetch
    let timeoutId;
    return new Promise(async (resolve, reject) => {
        timeoutId = setTimeout(() => {
            console.error(`PDF Generation Timeout (${generationTimeout}ms)`);
            reject(new Error(`PDF generation timed out.`));
        }, generationTimeout);

        try {
            const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true, autoFirstPage: false });
            doc.addPage();
            const buffers = [];
            const dateStr = getNairobiTimeString();
            const dateTimeStr = getNairobiTimeString('datetime');

            // PDF Styling Constants
            const colors = {
                primary: '#1a237e',     // Dark blue for headings
                secondary: '#303f9f',   // Medium blue for subheadings
                text: '#424242',        // Dark grey for main text
                light: '#e3f2fd',       // Light blue for dividers
                accent: '#ff9800',      // Orange for highlights
                background: '#f9f9f9',  // Light grey for boxes/sections
                border: '#9fa8da'       // Border color
            };

            // --- QR CODE Generation ---
            let qrCodeData = null;
            let qrCodeText = '';
            const qrSize = 60; // Increased QR size
            try {
                if (reportType === 'repair') {
                    qrCodeText = `REPAIR\nReg: ${data.reg_no}\nTeam: ${data.team || 'Eldoret'}\nLoc: ${data.location || 'N/A'}\nTime: ${dateTimeStr}`;
                } else {
                    qrCodeText = `${reportType.toUpperCase()}\nOMC: ${data.omc_name || 'N/A'}\nTime: ${dateTimeStr}\nTrucks: ${data.trucks.length}`;
                }
                const maxQrLength = 200;
                if (qrCodeText.length > maxQrLength) {
                    qrCodeText = qrCodeText.substring(0, maxQrLength - 3) + "...";
                    console.warn("[PDF Debug] QR Code text truncated.");
                }
                qrCodeData = await qrcode.toBuffer(qrCodeText, {
                    errorCorrectionLevel: 'M',
                    type: 'png',
                    margin: 1,
                    scale: 4
                });
                console.log(`[PDF Debug] QR Code generated successfully.`);
            } catch (qrError) {
                console.error("Error generating QR Code:", qrError);
                await notifyAdmin(`*PDF QR Code Gen Error:*\nType: ${reportType}\nError: ${qrError.message || qrError}`);
            }

            // --- Fetch Tanker Image ---
            let tankerImageBuffer = null;
            if (reportType === 'repair' && TANKER_IMAGE_URL) {
                console.log(`[PDF Debug] Fetching tanker image from: ${TANKER_IMAGE_URL}`);
                try {
                    const response = await fetch(TANKER_IMAGE_URL);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
                    }
                    tankerImageBuffer = await response.buffer();
                    console.log(`[PDF Debug] Tanker image fetched successfully (${tankerImageBuffer.length} bytes)`);
                } catch (fetchError) {
                    console.error("Error fetching tanker watermark image:", fetchError);
                    await notifyAdmin(`*PDF Tanker Watermark Fetch Error:*\nURL: ${TANKER_IMAGE_URL}\nError: ${fetchError.message || fetchError}`);
                }
            }

            // --- Fetch Logo Image if it's a URL ---
            let logoImageBuffer = null;
            if (LOGO_IMAGE_URL && LOGO_IMAGE_URL.startsWith('http')) {
                try {
                    logoImageBuffer = await fetchImageFromUrl(LOGO_IMAGE_URL);
                    console.log(`[PDF Debug] Logo image fetched successfully (${logoImageBuffer ? logoImageBuffer.length : 0} bytes)`);
                } catch (logoFetchErr) {
                    console.error("Error fetching logo image:", logoFetchErr);
                }
            }

            // --- PDFKit Event Handlers ---
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                clearTimeout(timeoutId);
                try {
                    const pdfData = Buffer.concat(buffers);
                    if (pdfData.length === 0) {
                        reject(new Error("Generated PDF buffer was empty."));
                    } else {
                        resolve(pdfData.toString('base64'));
                    }
                } catch (e) {
                    reject(new Error("Internal error finalizing PDF data."));
                }
            });
            doc.on('error', (err) => {
                clearTimeout(timeoutId);
                reject(err);
            });

            // --- Helper Functions for PDF Generation ---
            const drawBox = (x, y, width, height, options = {}) => {
                const radius = options.radius || 5;
                const fillColor = options.fillColor || colors.background;
                const strokeColor = options.strokeColor || colors.border;
                const lineWidth = options.lineWidth || 1;
                doc.save()
                   .roundedRect(x, y, width, height, radius)
                   .fillAndStroke(fillColor, strokeColor)
                   .lineWidth(lineWidth)
                   .restore();
                return y + height;
            };

            const drawSection = (title, contentY, contentCallback) => {
                const marginX = 50;
                const marginY = 15;
                const width = doc.page.width - (marginX * 2);
                // Section header
                doc.save()
                   .fillColor(colors.primary)
                   .fontSize(12)
                   .font('Helvetica-Bold')
                   .text(title, marginX, contentY, { width })
                   .restore();
                // Border line under section title
                doc.save()
                   .strokeColor(colors.primary)
                   .lineWidth(1)
                   .moveTo(marginX, contentY + 20)
                   .lineTo(marginX + width, contentY + 20)
                   .stroke()
                   .restore();
                // Call content callback with position for content
                contentY += 30;
                if (contentCallback) {
                    contentY = contentCallback(marginX, contentY, width);
                }
                return contentY + marginY; // Return the new Y position
            };

            // --- Watermark (Text & Image) ---
            const addWatermark = (text, isRepair = false) => {
                try {
                    doc.save();
                    const centerX = doc.page.width / 2;
                    const centerY = doc.page.height / 2;
                    doc.fillColor('#f0f0f0').fontSize(isRepair ? 78 : 64).opacity(0.13).rotate(-40, {origin: [centerX, centerY]})
                       .text(text, 0, centerY, {align: 'center', width: doc.page.width});
                    doc.restore();
                } catch (e) {
                    console.error("Error drawing watermark:", e);
                }
            };
            if (reportType === 'repair') addWatermark("URGENT REPAIR", true);
            else addWatermark(reportType.toUpperCase() + " STAY", false);

            // --- PDF Header ---
            let currentY = doc.page.margins.top;
            const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
            // Header box
            const headerHeight = 80;
            drawBox(doc.page.margins.left, currentY, pageWidth, headerHeight, {
                fillColor: '#f5f5ff',
                strokeColor: colors.primary,
                lineWidth: 1.5,
                radius: 8
            });

            // Logo placement (if available) - Updated with proper buffer handling
            if (LOGO_IMAGE_URL) {
                try {
                    const logoSize = 60;
                    if (logoImageBuffer) {
                        // Use the fetched buffer
                        doc.image(logoImageBuffer, doc.page.margins.left + 15, currentY + 10, {
                            fit: [logoSize, logoSize],
                            align: 'left'
                        });
                    } else if (LOGO_IMAGE_URL.startsWith('/') || !LOGO_IMAGE_URL.startsWith('http')) {
                        // If it's a local file path
                        doc.image(LOGO_IMAGE_URL, doc.page.margins.left + 15, currentY + 10, {
                            fit: [logoSize, logoSize],
                            align: 'left'
                        });
                    } else {
                        // If fetch failed or is not implemented, log but don't fail
                        console.warn("Could not load logo image from URL");
                    }
                } catch(logoErr) {
                    console.error("Error placing logo in PDF:", logoErr);
                    // Don't throw so PDF generation continues
                }
            }

            // Company name and report title
            const titleX = LOGO_IMAGE_URL ? doc.page.margins.left + 90 : doc.page.margins.left + 15;
            doc.fontSize(16)
               .font('Helvetica-Bold')
               .fillColor(colors.primary)
               .text(COMPANY_NAME, titleX, currentY + 15);
            doc.fontSize(14)
               .fillColor(colors.secondary)
               .text(reportType === 'repair' ? 'TRUCK MAINTENANCE NOTIFICATION' :
                    `${reportType.toUpperCase()} TRUCKS NOTIFICATION`,
                    titleX, currentY + 35);

            // Registration number highlight for repair reports
            if (reportType === 'repair' && data.reg_no) {
                doc.save()
                   .roundedRect(titleX, currentY + 55, 180, 20, 4)
                   .fillAndStroke('#e3f2fd', colors.secondary);
                doc.fillColor(colors.secondary)
                   .fontSize(12)
                   .font('Helvetica-Bold')
                   .text(data.reg_no, titleX + 5, currentY + 58);
                doc.restore();
            }

            currentY += headerHeight + 20; // Move below header with spacing

            // --- Content Sections based on report type ---
            if (reportType === 'repair') {
                // Content for Repair Report
                currentY = drawSection('Vehicle & Driver Details', currentY, (x, y, width) => {
                    const boxHeight = 100;
                    const endY = drawBox(x, y, width, boxHeight, {
                        fillColor: '#fcfcff',
                        strokeColor: colors.border
                    });

                    const detailsX = x + 15;
                    const detailsY = y + 15;
                    const colWidth = width / 2 - 20;

                    // Column 1
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Registration Number:', detailsX, detailsY);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text(data.reg_no || 'N/A', detailsX + 120, detailsY, { width: colWidth });

                    // Entry number (if available)
                    if (data.entry_no) {
                        doc.font('Helvetica-Bold')
                           .fontSize(10)
                           .fillColor(colors.secondary)
                           .text('Entry Number:', detailsX, detailsY + 25);

                        doc.font('Helvetica')
                           .fontSize(10)
                           .fillColor(colors.text)
                           .text(data.entry_no, detailsX + 120, detailsY + 25, { width: colWidth });
                    }

                    // Column 2
                    const col2X = x + width/2 + 10;
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Driver\'s Name:', col2X, detailsY);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text(data.driver_name || 'N/A', col2X + 85, detailsY, { width: colWidth });

                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Mobile Number:', col2X, detailsY + 25);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text(data.driver_no || 'N/A', col2X + 85, detailsY + 25, { width: colWidth });

                    // Add driver contact button/box with phone icon
                    if (data.driver_no) {
                        const buttonY = detailsY + 50;
                        const buttonWidth = 180;
                        doc.save()
                            .roundedRect(col2X, buttonY, buttonWidth, 25, 5)
                            .fillAndStroke('#4caf50', '#2e7d32')
                            .restore();

                        // Add phone icon
                        doc.save()
                            .roundedRect(col2X + 5, buttonY + 5, 15, 15, 3)
                            .fill('white');
                        // Simple phone receiver
                        doc.moveTo(col2X + 8, buttonY + 8)
                            .lineTo(col2X + 17, buttonY + 17)
                            .lineWidth(2)
                            .stroke('white');

                        doc.font('Helvetica-Bold')
                            .fontSize(9)
                            .fillColor('white')
                            .text(`CONTACT DRIVER: ${data.driver_no}`, col2X + 25, buttonY + 8,
                                  { width: buttonWidth - 30, align: 'left' });
                    }

                    return endY;
                });

                currentY += 10;

                // Maintenance details section
                currentY = drawSection('Maintenance Information', currentY, (x, y, width) => {
                    const boxHeight = 120;
                    const endY = drawBox(x, y, width, boxHeight, {
                        fillColor: '#fcfcff',
                        strokeColor: colors.border
                    });

                    const detailsX = x + 15;
                    const detailsY = y + 15;

                    // Location with styled heading
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Location:', detailsX, detailsY);

                    // Location with highlight box
                    const locationBoxY = detailsY + 5;
                    const locationText = data.location || 'N/A';
                    doc.font('Helvetica')
                       .fontSize(12);

                    // Calculate text dimensions
                    const locationWidth = Math.min(doc.widthOfString(locationText) + 20, width - 100);
                    const locationHeight = 25;

                    // Draw highlight box for location
                    doc.save()
                       .roundedRect(detailsX + 70, locationBoxY, locationWidth, locationHeight, 4)
                       .fillAndStroke('#e8f5e9', '#81c784')
                       .restore();

                    doc.fillColor('#2e7d32')
                       .text(locationText, detailsX + 80, locationBoxY + 7, {
                           width: locationWidth - 20,
                           align: 'center'
                       });

                    // Other maintenance details
                    const infoY = locationBoxY + 40;
                    const infoColWidth = (width / 3) - 20;

                    // Site Details
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Site Details:', detailsX, infoY);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text('Along Uganda Road', detailsX + 80, infoY, { width: infoColWidth });

                    // Cargo Type
                    const col2X = x + (width/3) + 25; // Increased offset to prevent overlap
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Cargo Type:', col2X, infoY);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text('WET CARGO', col2X + 80, infoY, { width: infoColWidth });

                    // Expected Duration with highlight
                    const col3X = x + 2*(width/3) + 25; // Increased offset for better spacing
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Duration:', col3X, infoY);

                    // Draw duration highlight pill
                    const durationText = `${data.duration || 24} hours`;
                    const durationWidth = doc.widthOfString(durationText) + 20;
                    const durationHeight = 20;

                    doc.save()
                       .roundedRect(col3X + 70, infoY - 2, durationWidth, durationHeight, 10)
                       .fillAndStroke(data.duration === 48 ? '#ffecb3' : '#e3f2fd',
                                     data.duration === 48 ? '#ffb300' : '#1976d2')
                       .restore();

                    doc.font('Helvetica-Bold')
                       .fontSize(9)
                       .fillColor(data.duration === 48 ? '#bf360c' : '#0d47a1')
                       .text(durationText, col3X + 80, infoY + 2, {
                           width: durationWidth - 20,
                           align: 'center'
                       });

                    return endY;
                });

                currentY += 10;

                // Contact information section
                currentY = drawSection('Contact Information', currentY, (x, y, width) => {
                    const boxHeight = 60;
                    const endY = drawBox(x, y, width, boxHeight, {
                        fillColor: '#fcfcff',
                        strokeColor: colors.border
                    });

                    const detailsX = x + 15;
                    const detailsY = y + 15;

                    // Email with icon-like prefix
                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text('Email:', detailsX, detailsY);

                    const emailText = data.email || 'N/A';

                    // Draw email icon
                    doc.save()
                       .roundedRect(detailsX + 50, detailsY - 2, 20, 20, 3)
                       .fillAndStroke('#e3f2fd', '#1976d2')
                       .restore();

                    doc.font('Helvetica-Bold')
                       .fontSize(12)
                       .fillColor('#0d47a1')
                       .text('@', detailsX + 55, detailsY);

                    // Email value
                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor('#0d47a1')
                       .text(emailText, detailsX + 80, detailsY, { width: width - 100, underline: true });

                    return endY;
                });
            } else {
                // Content for Overnight/overstay Report
                currentY = drawSection('Company Information', currentY, (x, y, width) => {
                    const boxHeight = 70;
                    const endY = drawBox(x, y, width, boxHeight, {
                        fillColor: '#fcfcff',
                        strokeColor: colors.border
                    });

                    const detailsX = x + 15;
                    const detailsY = y + 15;

                    doc.font('Helvetica-Bold')
                       .fontSize(10)
                       .fillColor(colors.secondary)
                       .text(`Company: ${data.omc_name ? data.omc_name.toUpperCase() : 'N/A'}`, detailsX, detailsY);

                    doc.font('Helvetica')
                       .fontSize(10)
                       .fillColor(colors.text)
                       .text(`Report Type: ${reportType.toUpperCase()} Stay Request`, detailsX, detailsY + 15)
                       .text(`Total Trucks: ${data.trucks.length}`, detailsX, detailsY + 30)
                       .text(`Email: ${data.email}`, detailsX, detailsY + 45);

                    return endY;
                });

                currentY += 10;

                if (data.trucks && data.trucks.length > 0) {
                    currentY = drawSection('Truck Details', currentY, (x, y, width) => {
                        const boxHeight = Math.max(60, data.trucks.length * 15 + 30);
                        const endY = drawBox(x, y, width, boxHeight, {
                            fillColor: '#fcfcff',
                            strokeColor: colors.border
                        });

                        const detailsX = x + 15;
                        let lineY = y + 15;
                        data.trucks.forEach((truck, index) => {
                            doc.font('Helvetica')
                               .fontSize(10)
                               .fillColor(colors.text)
                               .text(`${index + 1}. ${truck.reg_no} - ${truck.reason || 'N/A'}`, detailsX, lineY);
                            lineY += 15;
                        });

                        return endY;
                    });
                }
            }

            // --- Draw Tanker Watermark (if fetched) ---
            if (reportType === 'repair' && tankerImageBuffer) {
                try {
                    const tankerY = doc.page.height - doc.page.margins.bottom - 90;
                    const tankerWidth = doc.page.width * 0.6; // Larger image
                    const tankerX = (doc.page.width - tankerWidth) / 2;
                    doc.save();
                    doc.opacity(0.1); // More subtle
                    doc.image(tankerImageBuffer, tankerX, tankerY, { width: tankerWidth, align: 'center' });
                    console.log(`[PDF Debug] Tanker watermark drawn from buffer at y: ${tankerY}`);
                    doc.restore();
                } catch (tankerDrawError) {
                    console.error("Error drawing tanker watermark from buffer:", tankerDrawError);
                    await notifyAdmin(`*PDF Tanker Watermark Draw Error:*\nError: ${tankerDrawError.message || tankerDrawError}`);
                }
            } else if (reportType === 'repair' && TANKER_IMAGE_URL && !tankerImageBuffer) {
                console.warn("[PDF Debug] Tanker watermark skipped due to previous fetch error.");
            }

            // --- Date info and QR code placement ---
            if (qrCodeData) {
                try {
                    const qrX = doc.page.width - doc.page.margins.right - qrSize - 10;
                    const qrY = currentY + 10;
                    doc.image(qrCodeData, qrX, qrY, { fit: [qrSize, qrSize] });

                    // Date under QR - ensure it doesn't overlap with other elements
                    doc.fontSize(8)
                       .font('Helvetica')
                       .fillColor(colors.text)
                       .text(`Generated: ${dateStr}`, qrX, qrY + qrSize + 8, {
                           width: qrSize,
                           align: 'center'
                       });

                    console.log(`[PDF Debug] QR drawn, new Y: ${qrY + qrSize + 8}`);
                } catch (imageError) {
                    console.error("Error drawing QR Code image:", imageError);
                }
            } else {
                // If no QR code, still show date at top right
                const dateTextWidth = doc.widthOfString(`Date: ${dateStr}`);
                const dateX = doc.page.width - doc.page.margins.right - dateTextWidth;
                doc.fontSize(9)
                   .fillColor(colors.text)
                   .text(`Date: ${dateStr}`, dateX, currentY + 15);
            }

            // --- Footer ---
            doc.strokeColor(colors.light)
               .lineWidth(1)
               .moveTo(doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 25)
               .lineTo(doc.page.width - doc.page.margins.right, doc.page.height - doc.page.margins.bottom - 25)
               .stroke();

            // Footer text
            doc.fontSize(8)
               .font('Helvetica')
               .fillColor('#777777')
               .text('This is an automatically generated report. Please contact support if you have any questions.',
                     doc.page.margins.left,
                     doc.page.height - doc.page.margins.bottom - 20,
                     { align: 'center', width: pageWidth });

            doc.fontSize(7.5)
               .fillColor('#AAAAAA')
               .text(`Generated on ${dateTimeStr}`,
                     doc.page.margins.left,
                     doc.page.height - doc.page.margins.bottom - 10,
                     { align: 'center', width: pageWidth });

            console.log(`[PDF Gen End] Finalizing PDF generation with QR for type: ${reportType}`);
            doc.end();
        } catch (initError) {
            clearTimeout(timeoutId);
            console.error(`[PDF Gen Error - Initial] Type: ${reportType}, Error: ${initError.message}`);
            reject(initError);
        }
    }).finally(() => {
        console.log(`[PDF Gen Finish] Promise resolved/rejected for Type: ${reportType}, ID: ${(reportType === 'repair' ? data.reg_no : data.omc_name) || 'N/A'}`);
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
    const pdfBuffer = await generateReportPdf(details, 'repair');  // Changed to generateReportPdf

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
    const pdfBuffer = await generateReportPdf(details, 'repair');  // Changed to generateReportPdf
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
    // Check for required fields
    const missing = [];
    if (!data.reg_no) missing.push('Registration Number');
    if (!data.driver_name) missing.push('Driver Name');
    if (!data.driver_no) missing.push('Mobile Number');
    if (!data.location) missing.push('Location');
    
    if (missing.length > 0) {
      await ctx.reply(`⚠️ Missing required fields: ${missing.join(', ')}`);
      return;
    }
    
    await ctx.reply(`🛠️ Processing maintenance report for *${data.reg_no}*...`, { parse_mode: 'Markdown' });
    
    // Generate email body
    const emailBody = createRepairEmailBody(data);
    
    // Generate PDF - it returns a base64 string
    const pdfBase64 = await generateReportPdf(data, 'repair');
    
    // Convert base64 string to buffer
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    
    // Send PDF to user
    await ctx.replyWithDocument({ 
      source: pdfBuffer, 
      filename: `${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}-Report.pdf` 
    });
    
    // Send email if we have an email address
    if (data.email) {
      await transporter.sendMail({
        from: SMTP_USER,
        to: data.email,
        subject: `Repair Report - ${data.reg_no}`,
        text: emailBody,
        attachments: [{ 
          filename: `${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, 
          content: pdfBuffer 
        }],
      });
      
      await ctx.replyWithMarkdown(`📧 Email sent to ${data.email} for *${data.reg_no}*`);
    } else {
      await ctx.reply("Report created but no email address found to send to.");
    }
  } catch (err) {
    console.error('Error processing repair report:', err);
    await ctx.reply(`❌ Report Generation Failed: ${err.message}`);
    await notifyAdmin(`Error creating repair report: ${err.message}`);
  }
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

// Launch bot only in development
if (process.env.NODE_ENV !== 'production') {
  bot.launch().then(() => {
    console.log('Bot started in development mode');
  }).catch(err => {
    console.error('Error starting bot:', err);
  });
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

export default handler;  // Export the handler function instead of the bot
