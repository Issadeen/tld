// --- Requires ---
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const PDFDocument = require('pdfkit');
const fs = require('fs'); 
const healthCheck = require('./health-check');
const startupCheck = require('./startup-check');
const storageHelper = require('./storage-helper');
const dataValidator = require('./data-validator'); // Add this line

// Run environment checks
startupCheck.checkEnvironment();

// Get the appropriate session storage path based on environment
// const sessionConfig = storageHelper.getSessionPath();
// const SESSION_DIR = sessionConfig.path;
// const SESSION_DIR = '/tmp/whatsapp_session'; // Use local container filesystem for Chromium compatibility
const SESSION_DIR = '/tmp/whatsapp_session'; // Use /tmp for session persistence and file locking compatibility

// --- Early console logs to verify this constant ---
console.log(`INFO: Defined SESSION_DIR as: ${SESSION_DIR}`);

// --- Ensure the directory exists early ---
try {
    if (!fs.existsSync(SESSION_DIR)) {
        console.log(`INFO: Attempting to create session directory: ${SESSION_DIR}`);
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        console.log(`INFO: Session directory created (or already existed): ${SESSION_DIR}`);
    } else {
        console.log(`INFO: Session directory already exists: ${SESSION_DIR}`);
    }
} catch (err) {
    console.error(`FATAL: Failed to create session directory ${SESSION_DIR}. Error: ${err.message}. Please check permissions. Exiting.`);
    process.exit(1); // Exit if we can't create this critical directory
}

// --- Load Environment Variables ---
dotenv.config();

// ==================================================================================
//  CONFIGURATION
// ==================================================================================
// --- GOOGLE SCRIPT CONFIGURATION ---
// PASTE THE 'exec' URL OF YOUR LATEST GOOGLE APPS SCRIPT DEPLOYMENT HERE
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxoyuh-NaJadkLf39G5Lt6OPnqso5PFPSrCHhQad0h8OemqWfxhcQJNy8pvHntsvKcd/exec";
// Set this environment variable for runtime config, otherwise the hardcoded URL above will be used
console.log(`INFO: Using hardcoded GOOGLE_SCRIPT_URL: ${GOOGLE_SCRIPT_URL}`);

// --- BOT & NOTIFICATION CONFIGURATION ---
// The WWEBJS_DATA_PATH constant defined above will be used for LocalAuth.
// All previous SESSION_DIR logic and environment variable reading for this specific path is removed.
console.log(`INFO: WhatsApp client will use dataPath: ${SESSION_DIR} for LocalAuth.`);
// The old log '✅ Initializing with session directory:' is removed to avoid confusion.

const ADMIN_NUMBER = process.env.ADMIN_NUMBER;
const PING_TARGET_NUMBER = process.env.PING_TARGET_NUMBER;
const TANKER_IMAGE_URL = process.env.TANKER_IMAGE_URL;
const LOGO_IMAGE_URL = process.env.LOGO_IMAGE_URL;
const COMPANY_NAME = process.env.COMPANY_NAME || "Emperor's Bot Service";

// --- Add this line to define PING_INTERVAL_MS (default: 60 minutes) ---
const PING_INTERVAL_MS = parseInt(process.env.PING_INTERVAL_MINUTES || "60", 10) * 60 * 1000;

// --- EMAIL CONFIGURATION ---
const SMTP_SERVER = process.env.SMTP_SERVER;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USERNAME = process.env.SMTP_USERNAME;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const FROM_EMAIL = process.env.FROM_EMAIL;
const DEFAULT_RECIPIENTS = (process.env.DEFAULT_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
// ==================================================================================

// --- Helper function to get Nairobi time string ---
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
        return now.toLocaleString('en-GB', options); // Format: DD/MM/YYYY, HH:MM:SS
    } else { // Default to date
        options.year = 'numeric';
        options.month = 'long';
        options.day = 'numeric';
        return now.toLocaleDateString('en-GB', options); // Format: D MMMM YYYY
    }
}


// --- Express App Setup & Global Variables---
const app = express();
app.use(bodyParser.json());
const expressPort = process.env.PORT || 3000;

// Add health check route
app.use('/health', healthCheck.router);

let client = null;
let currentQR = '', latestQR = null;
let pingIntervalId = null;
const REPAIR_REQUESTS = {};
const MESSAGE_STATS = { total_requests: 0, successful_emails: 0, failed_emails: 0, start_time: Date.now(), last_message_time: null };
let isReady = false;
// Fix: Initialize pendingAdminMessages as a global array 
let pendingAdminMessages = [];
let GSWizardSessions = {}; // Added for Google Sheet Creation Wizard

// --- Placeholder for setupHealthMonitoring ---
function setupHealthMonitoring() {
    console.log("INFO: setupHealthMonitoring called (placeholder function).");
    // Implement your health monitoring logic here if needed
    // For example, you might set up an interval to check client.getState()
    // and notifyAdmin if the bot becomes unhealthy.
}

// --- Placeholder for sendMainMenu ---
async function sendMainMenu(chatId) {
    console.log(`INFO: sendMainMenu called for ${chatId} (placeholder function).`);
    if (client && isReady) {
        try {
            const menuMessage = `Welcome! Here are some commands you can use:\n` +
                                `\`/newtruck\` - Start a new truck entry wizard.\n` +
                                `\`/status <reg_no> [sct]\` - Check truck status.\n` +
                                `\`/row <row_no> [sct]\` - Get details for a specific row.\n` +
                                `\`/system\` - Check bot system status.\n` +
                                `\`/help\` - Show detailed help.`;
            await client.sendMessage(chatId, menuMessage);
        } catch (error) {
            console.error(`Error sending main menu to ${chatId}:`, error);
        }
    } else {
        console.warn(`Cannot send main menu to ${chatId}: Client not ready.`);
    }
}


// --- Startup Checks ---
if (!ADMIN_NUMBER) {
    console.error("FATAL: ADMIN_NUMBER not set in environment variables! Exiting.");
    process.exit(1);
}
// The check for GOOGLE_SCRIPT_URL being a placeholder is still relevant
if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL === "https://script.google.com/macros/s/AKfycbyzoZNH5oGE_-CiK0ayjfIY-BiV9PJKXPNROCeshb5V0dpkhk4ZtkKT8cGdJYGvegLM/exec" || !GOOGLE_SCRIPT_URL.startsWith("https://script.google.com/macros/s/")) {
    console.error("FATAL: GOOGLE_SCRIPT_URL is not set correctly in wpp-bot.js! It should be a valid Apps Script 'exec' URL. The Google Sheets integration will not work. Exiting.");
    process.exit(1);
}

// --- Internal Ping Logic ---
async function initializePing() {
    if (!client || !isReady) { console.warn("Ping init: Client not ready."); return; }
    if (pingIntervalId) return;
    if (!PING_TARGET_NUMBER) { console.warn("Ping init: PING_TARGET_NUMBER not set."); return; }
    console.log("Attempting initial keep-alive ping to " + PING_TARGET_NUMBER + "...");
    try {
        await client.sendMessage(PING_TARGET_NUMBER, "Bot connected - Initializing internal ping.");
        console.log("Initial internal ping sent to " + PING_TARGET_NUMBER);
        startPingInterval();
    } catch (error) {
        console.error("Initial internal ping failed:", error.message || error);
        await notifyAdmin(`*Initial Ping Failed:*\nTarget: ${PING_TARGET_NUMBER}\nError: ${error.message || error}`);
        startPingInterval();
    }
}

function startPingInterval() {
    stopPingInterval();
    if (!PING_TARGET_NUMBER) { return; }
    console.log(`Starting internal ping interval (${PING_INTERVAL_MS / 1000 / 60} minutes)...`);
    pingIntervalId = setInterval(async () => {
        if (!client || !isReady) { console.warn("Ping check: Client not ready. Stopping interval."); stopPingInterval(); return; }
        try {
            await client.sendMessage(PING_TARGET_NUMBER, "Internal Ping: Bot alive check.");
        } catch (error) {
            console.error(`Internal ping failed (Target: ${PING_TARGET_NUMBER}):`, error.message || error);
        }
    }, PING_INTERVAL_MS);
}

function stopPingInterval() {
    if (pingIntervalId) { console.log("Stopping internal ping interval."); clearInterval(pingIntervalId); pingIntervalId = null; }
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

            // Logo placement (if available)
            if (LOGO_IMAGE_URL) {
                try {
                    const logoSize = 60;
                    doc.image(LOGO_IMAGE_URL, doc.page.margins.left + 15, currentY + 10, {
                        fit: [logoSize, logoSize],
                        align: 'left'
                    });
                } catch(logoErr) {
                    console.error("Error placing logo in PDF:", logoErr);
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

// --- Helper: Notify Admin ---
async function notifyAdmin(message) {
    // Use a more defensive check before accessing client methods
    if (!client) { 
        console.error("[Admin Notify Failed] Client not initialized. Message:", message); 
        return; 
    }
    if (!isReady) { 
        console.error("[Admin Notify Failed] Client not ready. Message:", message); 
        // Store messages to send once client is ready - fixed variable reference
        pendingAdminMessages.push(message);
        return; 
    }
    if (!ADMIN_NUMBER) { 
        console.error("[Admin Notify Failed] ADMIN_NUMBER not set. Message:", message); 
        return; 
    }
    
    try {
        const currentState = await client.getState(); 
        if (currentState !== 'CONNECTED') { 
            console.error(`[Admin Notify Failed] Client not connected (state: ${currentState}). Message: ${message}`); 
            return; 
        }
        const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' });
        const fullMessage = `\`\`\`BOT ALERT (${timestamp})\`\`\`\n\n${message}`;
        await client.sendMessage(ADMIN_NUMBER, fullMessage);
        console.log(`Admin notification sent to ${ADMIN_NUMBER}.`);
    } catch (error) { 
        console.error(`[Admin Notify Failed] Error sending notification to ${ADMIN_NUMBER}:`, error.message || error); 
    }
}

// --- Nodemailer Setup ---
let transporter;
if (SMTP_SERVER && SMTP_USERNAME && SMTP_PASSWORD && FROM_EMAIL) {
    transporter = nodemailer.createTransport({ 
        host: SMTP_SERVER, 
        port: SMTP_PORT, 
        secure: SMTP_PORT === 465, 
        auth: { user: SMTP_USERNAME, pass: SMTP_PASSWORD }, 
        tls: { rejectUnauthorized: false } 
    });
    
    // Fix: Make this more resilient by using a safer notifyAdmin call that checks if client exists
    transporter.verify()
        .then(() => console.log("Nodemailer is ready."))
        .catch(err => { 
            console.error("Nodemailer config error:", err); 
            // Only try to notify admin if client is initialized (defer notification until client is ready)
            setTimeout(() => {
                if (client && isReady) {
                    notifyAdmin(`*Nodemailer Config Error:*\n${err.message}`);
                }
            }, 10000); // Wait 10 seconds to allow client to initialize
        });
} else { 
    console.warn("SMTP not configured. Email sending disabled."); 
}

// --- Input Sanitization & Validation ---
function sanitizeInput(text) { if (!text) return ""; let sanitized = text.replace(/[^\x20-\x7E\r\n]/g, ''); return sanitized.trim(); }
function validateEmail(email) { if (!email || typeof email !== 'string') return false; const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; return emailRegex.test(email.trim()); }

// --- Parsing Logic (Includes Greetings) ---
function parseTruckRequest(message) {
    try {
        const cleanMessage = sanitizeInput(message);
        const lowerBody = cleanMessage.toLowerCase();

        // 1. Greetings
        const greetings = ['hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening', 'poa', 'sasa', 'mambo', 'niaje'];
        if (greetings.includes(lowerBody)) {
            return { status: 'greeting', type: lowerBody };
        }

        // 2. Commands
        if (cleanMessage.startsWith('/')) {
            return { status: 'command', command: cleanMessage.trim() };
        }

        const lines = cleanMessage.split('\n').map(line => line.trim()).filter(line => line);
        if (lines.length === 0) {
            return { status: 'error', message: 'Empty message received.' };
        }

        // --- CASE INSENSITIVE FIELD MATCHING FOR GOOGLE SHEET DATA ENTRY ---
        // Accept any case for "create truck:"
        if (lines[0].trim().toLowerCase().startsWith('create truck:')) {
            const sheetData = {
                truck: lines[0].substring(lines[0].toLowerCase().indexOf('create truck:') + 'create truck:'.length).trim(),
                targetSheet: 'TRANSIT' // Default to TRANSIT
            };
            const missingSheetFields = [];
            if (!sheetData.truck) missingSheetFields.push("Truck Number (after 'create truck:')");

            // Map of normalized field names to internal keys
            const fieldMappings = {
                'entry:': 'tr812',
                'entry note:': 'entryNote',
                'exit note:': 'exitNote',
                'consignor:': 'consignor',
                'consignee:': 'consignee',
                'destination:': 'destination',
                'bol:': 'bol',
                'order:': 'loadingOrder',
                'product:': 'product',
                'comp 1:': 'comp1',
                'comp 2:': 'comp2',
                'comp 3:': 'comp3',
                'comp 4:': 'comp4',
                'comp 5:': 'comp5',
                'comp 6:': 'comp6',
                'permit:': 'permit',
                'target:': 'targetSheetVal'
            };

            const requiredSheetFields = ['consignor', 'consignee', 'destination', 'bol', 'loadingOrder', 'product'];
            const foundFields = new Set();

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                // Normalize label: lowercase, trim, collapse spaces, ensure trailing colon
                const normLine = line.trim().toLowerCase().replace(/\s+/g, ' ');
                let matchFound = false;
                for (const prefix in fieldMappings) {
                    // Compare normalized line start with normalized prefix
                    if (normLine.startsWith(prefix)) {
                        const key = fieldMappings[prefix];
                        const value = line.substring(line.length - (line.length - prefix.length)).trim().substring(prefix.length).trim();
                        if (key === 'targetSheetVal') {
                            if (value.toLowerCase() === 'sct') {
                                sheetData.targetSheet = 'SCT';
                            }
                        } else {
                            sheetData[key] = line.substring(prefix.length).trim();
                            foundFields.add(key);
                        }
                        matchFound = true;
                        break;
                    }
                }
                if (!matchFound) console.warn(`[Parse GS] Unrecognized line: ${line}`);
            }

            // Rename tr812 to entryNote if target is SCT and entryNote isn't already set
            if (sheetData.targetSheet === 'SCT' && sheetData.tr812 && !sheetData.entryNote) {
                sheetData.entryNote = sheetData.tr812;
                delete sheetData.tr812;
                foundFields.delete('tr812');
                foundFields.add('entryNote');
            }
            
            // Check for required fields based on targetSheet
            if (sheetData.targetSheet === 'SCT') {
                if (!sheetData.entryNote) missingSheetFields.push("Entry Note (e.g., 'Entry Note: EN-123')");
                // Exit Note is optional for SCT creation via bot
            } else { // TRANSIT
                if (!sheetData.tr812) missingSheetFields.push("Entry (e.g., 'Entry: 12345')");
            }

            requiredSheetFields.forEach(field => {
                if (!sheetData[field]) {
                    missingSheetFields.push(field.charAt(0).toUpperCase() + field.slice(1) + ` (e.g., '${field}: Value')`);
                }
            });

            // Compartment defaults
            for (let i = 1; i <= 6; i++) {
                const compKey = `comp${i}`;
                sheetData[compKey] = parseFloat(sheetData[compKey]) || 0;
            }
            if (sheetData.comp1 === 0 && sheetData.comp2 === 0 && sheetData.comp3 === 0) {
                 // At least one of the first 3 comps should ideally have a value, but AppScript handles defaults.
                 // No specific missing field error here, as AppScript defaults to 0.
            }


            if (missingSheetFields.length > 0) {
                return { status: 'incomplete', type: 'google_sheet_data', missing: missingSheetFields };
            }
            return { status: 'google_sheet_data', type: sheetData.targetSheet === 'SCT' ? 'create_sct' : 'create_transit', data: sheetData };
        }

        // 4. Overnight/Overstay Reports
        const isOvernight = lines.some(line => line.toLowerCase().startsWith('overnight:'));
        const isOverstay = lines.some(line => line.toLowerCase().startsWith('overstay:'));
        if (isOvernight || isOverstay) {
            return parseReport(lines, isOvernight ? 'overnight' : 'overstay');
        }

        // 5. Default to Repair Request Parsing
        const data = {}; const missing = [];
        const requiredFields = ['Registration Number', 'Driver Name', 'Mobile Number', 'Location', 'Email Address'];
        if (lines.length < 4) { // Basic check, more detailed below
            missing.push(...requiredFields.slice(lines.length > 4 ? 4 : lines.length));
            if (!lines.some(line => validateEmail(line.split(/[\s:]+/).find(validateEmail) || ''))) {
                missing.push('Email Address');
            }
            return { status: 'incomplete', type: 'repair', missing: [...new Set(missing)] };
        }
        data.reg_no = lines[0]; data.driver_name = lines[1] || null; data.driver_no = lines[2] || null; data.location = lines[3] || null;
        data.email = ''; data.entry_no = null; data.duration = 24; data.team = "Eldoret"; let emailFound = false;
        
        lines.forEach(line => {
            const separatorIndex = line.indexOf(':'); let key = ''; let value = line;
            if (separatorIndex !== -1) { key = line.substring(0, separatorIndex).trim().toLowerCase(); value = line.substring(separatorIndex + 1).trim(); }
            
            if (key === 'entry') { data.entry_no = value; }
            else if (key === 'hours') { const h = parseInt(value, 10); if (!isNaN(h) && [24, 48].includes(h)) data.duration = h; }
            else if (key === 'team') { data.team = value || "Eldoret"; data.team = data.team.charAt(0).toUpperCase() + data.team.slice(1).toLowerCase(); }
            else if (key === 'email' ) { if (validateEmail(value)) { data.email = value; emailFound = true; } }
            else if (!emailFound) { const foundEmail = line.split(/[\s<>(),;:]+/).find(validateEmail); if (foundEmail) { data.email = foundEmail; emailFound = true; } }
        });

        if (!data.reg_no) missing.push('Registration Number (First line)');
        if (!data.driver_name) missing.push('Driver Name (Second line)');
        if (!data.driver_no) missing.push('Mobile Number (Third line)');
        if (!data.location) missing.push('Location (Fourth line)');
        if (!emailFound) missing.push('A valid Email Address (anywhere in the message)');
        
        if (missing.length > 0) { return { status: 'incomplete', type: 'repair', missing: [...new Set(missing)] }; }
        return { status: 'complete', type: 'repair', data };

    } catch (error) { 
        console.error("Error parsing message:", error); 
        return { status: 'error', message: 'Internal error during message parsing.' }; 
    }
}
function parseReport(lines, type) {
    // console.warn(`parseReport called for ${type}, but not fully implemented in this combined script.`); // This line generates a log entry.
    const data = { omc_name: null, email: null, trucks: [] };
    let currentTruck = null;
    let emailFound = false;

    lines.forEach(line => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) return;
        const key = line.substring(0, separatorIndex).trim().toLowerCase();
        const value = line.substring(separatorIndex + 1).trim();
        if (key === 'omc') data.omc_name = value;
        else if (key === 'email') { if (validateEmail(value)) { data.email = value; emailFound = true; } }
        else if (key === 'truck') {
            currentTruck = { reg_no: value, reason: null };
            data.trucks.push(currentTruck);
        } else if (key === 'reason' && currentTruck) {
            currentTruck.reason = value;
        }
    });
    const missing = [];
    if (!data.omc_name) missing.push('OMC Name (using "omc: [Name]")');
    if (!emailFound) missing.push('Email Address (using "email: [Address]")');
    if (data.trucks.length === 0) missing.push('At least one truck (using "truck: [Reg No]")');
    else {
        data.trucks.forEach((truck, index) => {
            if (!truck.reg_no) missing.push(`Truck ${index + 1} Registration Number`);
            if (!truck.reason) missing.push(`Truck ${index + 1} Reason (using "reason: [Reason]")`);
        });
    }
    if (missing.length > 0) return { status: 'incomplete', type: type, missing };
    return { status: 'complete', type: type, data };
}

// --- Email Content Generation ---
function createRepairEmailBody(data) { const entryInfo = data.entry_no ? `\n• Entry Number: ${data.entry_no}` : ""; const dateStr = new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi' }); return `Date: ${dateStr}\n\nDear RRU Team ${data.team || 'Eldoret'},\n\nTRUCK MAINTENANCE NOTIFICATION - ${data.reg_no}\n\nThe truck below has developed a mechanical problem and will be undergoing repairs.\n\nVehicle & Driver Details:\n----------------------\n• Registration Number: ${data.reg_no}${entryInfo}\n• Driver's Name: ${data.driver_name}\n• Mobile Number: ${data.driver_no}\n\nMaintenance Information:\n---------------------\n• Location: ${data.location}\n• Site Details: Along Uganda Road\n• Cargo Type: WET CARGO\n• Expected Duration: ${data.duration || 24} hours\n\nThank you for your attention to this matter.`; }
function createReportEmailBody(data, reportType) {
    const dateStr = getNairobiTimeString();
    const titleType = reportType.toUpperCase();
    const trucksList = data.trucks.map(truck => `• ${truck.reg_no} - ${truck.reason || 'N/A'}`).join("\n");
    return `Date: ${dateStr}\n\n${titleType} TRUCKS NOTIFICATION\n---------------------------\n\nCompany: ${data.omc_name ? data.omc_name.toUpperCase() : 'N/A'}\nReport Type: ${titleType} Stay Request\nTotal Trucks: ${data.trucks.length}\n\nThe following trucks from ${data.omc_name ? data.omc_name.toUpperCase() : 'N/A'} will be ${reportType === 'overnight' ? 'spending the night' : 'overstaying'} at the depot:\n\n${trucksList}\n\nContact Information:\n-----------------\nEmail: ${data.email}\n\nThis is an automated notification. Please contact the company representative if you need additional information.\n\nThank you for your attention to this matter.`;
}

// --- Helper Functions for Commands ---
function getFormatInstructions(reportType = 'repair') {
    const repairFormat = `📝 *Maintenance Report Format*\n\n*Required Fields:*\n\`\`\`\nRegistration Number\nDriver Name\nMobile Number\nLocation\n[Your Email Address - anywhere in msg]\n\`\`\`\n*Optional Fields (Use Labels):*\n\`\`\`\nentry: [Entry Number]\nhours: [24 or 48] (default: 24)\nteam: [Team Name] (default: Eldoret)\n\`\`\`\nExample:\n\`\`\`\nKCC492P/ZG1633\nYUSSUF MAALIM\n0722809260\nHASS PETROLEUM ELDORET DEPOT\ndriver@company.com\nteam: Nairobi\nhours: 48\n\`\`\``;
    const reportFormat = (type) => `📝 *${type.charAt(0).toUpperCase() + type.slice(1)} Report Format*\n\n*Required Fields (Use Labels):*\n\`\`\`\n${type}: yes\nomc: [Company Name]\nemail: [Your Email Address]\ntruck: [Registration Number]\nreason: [Reason for ${type}]\n\`\`\`\n*Repeat truck/reason for multiple trucks:*\nExample:\n\`\`\`\n${type}: yes\nomc: ABC Logistics\nemail: manager@abclogistics.com\ntruck: KCC492P\nreason: Mechanical issue\ntruck: KDD123X\nreason: Driver rest\n\`\`\``;
    const transitFormat = `📝 *TRANSIT/SCT Truck Data - Full Message Format*\n
*This is for advanced users. For easier entry, use the \`/newtruck\` command for a guided wizard.*\n
*Required Fields (each on its own line, order matters!):*
\`\`\`
create truck: [TRUCK NO]
Entry: [Entry No for TRANSIT] or Entry Note: [Entry Note for SCT]
Consignor: [Consignor Name]
Consignee: [Consignee Name]
Destination: [Destination]
Bol: [BOL No]
Order: [50059360]
Product: [AGO, PMS, IK, Other]
Comp 1: [Value]
Comp 2: [Value]
Comp 3: [Value]
Comp 4: [Value]
Comp 5: [Value]
Comp 6: [Value]
Permit: [SSD Permit No.] (optional, only for TRANSIT SSD)
Exit Note: [Exit Note] (optional, only for SCT)
\`\`\`
- *For SCT, add "target: SCT" as the last line if not using "Entry Note:".*

*Example (TRANSIT - Full Message):*
\`\`\`
create truck: KAA123A
Entry: 12345
Consignor: ABC Ltd
Consignee: XYZ Ltd
Destination: DRC
Bol: 67890
Order: 50059360
Product: Diesel
Comp 1: 10000
Comp 2: 5000
Comp 3: 0
Permit: SSD-12345
\`\`\`
`;


    if (reportType === 'transit') return transitFormat;
    if (reportType === 'overnight') return reportFormat('overnight');
    if (reportType === 'overstay') return reportFormat('overstay');
    return repairFormat;
}

function getHelpMessage() {
    return `*Welcome to Issaerium bot chat, a smart way of working!* 🤖

*How to log a truck for TRANSIT/SCT Google Sheet:*
The easiest way is to use the guided wizard:
➡️ Type \`/newtruck\`
The bot will ask you for each piece of information step-by-step. You can review and edit before submitting!

*Other commands:*
- \`/format\` - Show detailed format instructions for manual full message entry (advanced).
- \`/status <reg_no> [sct]\` - Check truck status (add sct for SCT sheet).
- \`/row <row_no> [sct]\` - Get details for a specific row (add sct for SCT sheet).
- \`/system\` - Check bot system status.
- \`/testpdf\` - Generate sample PDF.
- \`/help\` - Show this help message.

*For maintenance reports, send details as a plain message (see \`/format repair\` for details).*
`;
}

// --- START OF NEW HANDLER FUNCTIONS ---

// --- Helper: Send Email with Attachment ---
async function sendEmailWithAttachment(to, subject, body, pdfBase64, filename, fromNumber) {
    if (!transporter) {
        console.warn("Email not sent: SMTP not configured.");
        if (fromNumber && client && isReady) {
            await client.sendMessage(fromNumber, "📧 Email feature is not configured. Admin has been notified.");
        }
        await notifyAdmin("Attempted to send email, but SMTP is not configured.");
        return false;
    }
    if (!to || to.length === 0) {
        console.warn("Email not sent: No recipients specified.");
        if (fromNumber && client && isReady) {
            await client.sendMessage(fromNumber, "📧 Email not sent: No recipient address provided.");
        }
        return false;
    }

    const mailOptions = {
        from: FROM_EMAIL,
        to: to,
        subject: subject,
        text: body,
        attachments: pdfBase64 ? [{
            filename: filename,
            content: pdfBase64,
            encoding: 'base64',
            contentType: 'application/pdf'
        }] : []
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully to ${to}. Subject: ${subject}`);
        MESSAGE_STATS.successful_emails++;
        return true;
    } catch (error) {
        console.error(`Error sending email to ${to}:`, error);
        MESSAGE_STATS.failed_emails++;
        if (fromNumber && client && isReady) {
            await client.sendMessage(fromNumber, `📧 Failed to send email. Admin has been notified. Error: ${error.message}`);
        }
        await notifyAdmin(`*Email Sending Failed:*\nTo: ${to}\nSubject: ${subject}\nError: ${error.message}`);
        return false;
    }
}

// --- Google Sheet Wizard Definitions ---
const WIZARD_STEPS = {
    start: {
        message: "Welcome to the New Truck Entry Wizard! 🚚\n\nFirst, what is the *Truck Registration Number*? (e.g., KAA123A)",
        next: "targetSheet",
        key: "truck"
    },
    targetSheet: {
        message: "Is this for *TRANSIT* or *SCT*?\nType `TRANSIT` or `SCT`.",
        next: (data) => data.targetSheet === 'SCT' ? "entryNoteSCT" : "entryTransit",
        key: "targetSheet",
        validate: (val) => ['TRANSIT', 'SCT'].includes(val.toUpperCase()),
        transform: (val) => val.toUpperCase()
    },
    entryTransit: {
        message: "Enter *Entry Number* for TRANSIT (e.g., 12345):",
        next: "consignor",
        key: "tr812"
    },
    entryNoteSCT: {
        message: "Enter *Entry Note* for SCT (e.g., EN-XYZ789):",
        next: "consignor",
        key: "entryNote"
    },
    consignor: {
        message: "Enter *Consignor Name*:",
        next: "consignee",
        key: "consignor"
    },
    consignee: {
        message: "Enter *Consignee Name*:",
        next: "destination",
        key: "consignee"
    },
    destination: {
        message: "Enter *Destination*:",
        next: "bol",
        key: "destination"
    },
    bol: {
        message: "Enter *BOL Number*:",
        next: "loadingOrder",
        key: "bol"
    },
    loadingOrder: {
        message: "Enter *Loading Order Number* (e.g., 50059360):",
        next: "product",
        key: "loadingOrder"
    },
    product: {
        message: "Enter *Product Type* (e.g., AGO, PMS, IK, Other):",
        next: "comp1",
        key: "product"
    },
    comp1: { message: "Enter *Compartment 1 Volume* (0 if empty):", next: "comp2", key: "comp1", validate: dataValidator.isNumeric, transform: parseFloat },
    comp2: { message: "Enter *Compartment 2 Volume* (0 if empty):", next: "comp3", key: "comp2", validate: dataValidator.isNumeric, transform: parseFloat },
    comp3: { message: "Enter *Compartment 3 Volume* (0 if empty):", next: "comp4", key: "comp3", validate: dataValidator.isNumeric, transform: parseFloat },
    comp4: { message: "Enter *Compartment 4 Volume* (0 if empty):", next: "comp5", key: "comp4", validate: dataValidator.isNumeric, transform: parseFloat },
    comp5: { message: "Enter *Compartment 5 Volume* (0 if empty):", next: "comp6", key: "comp5", validate: dataValidator.isNumeric, transform: parseFloat },
    comp6: {
        message: "Enter *Compartment 6 Volume* (0 if empty):",
        next: (data) => data.targetSheet === 'SCT' ? "exitNoteSCT" : "permitTransit",
        key: "comp6",
        validate: dataValidator.isNumeric,
        transform: parseFloat
    },
    permitTransit: {
        message: "Enter *Permit Number* (Optional, for TRANSIT SSD - type 'skip' if none):",
        next: "confirm",
        key: "permit",
        optional: true
    },
    exitNoteSCT: {
        message: "Enter *Exit Note* (Optional, for SCT - type 'skip' if none):",
        next: "confirm",
        key: "exitNote",
        optional: true
    },
    confirm: {
        message: (data) => {
            let summary = "*Review Your Entry:*\n\n";
            for (const key in data) {
                if (key !== 'step' && key !== 'fromNumber') { // Exclude internal wizard keys
                    summary += `*${key.charAt(0).toUpperCase() + key.slice(1)}:* ${data[key]}\n`;
                }
            }
            summary += "\nType `confirm` to submit, `edit <field_name>` to change a value (e.g., `edit truck`), or `cancel` to abort.";
            return summary;
        },
        next: null // Terminal step
    }
};

// --- Command Handler ---
async function handleCommand(commandString, fromNumber) {
    const parts = commandString.slice(1).trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    console.log(`[CMD] User ${fromNumber} sent command: /${command} with args: ${args.join(' ')}`);

    try {
        switch (command) {
            case 'help':
                await client.sendMessage(fromNumber, getHelpMessage());
                break;
            case 'format':
                const reportType = args[0] ? args[0].toLowerCase() : 'repair';
                await client.sendMessage(fromNumber, getFormatInstructions(reportType));
                break;
            case 'status':
            case 'row':
                if (command === 'status' && args.length < 1) {
                    await client.sendMessage(fromNumber, "Usage: `/status <reg_no> [sct]`");
                    return;
                }
                if (command === 'row' && args.length < 1) {
                    await client.sendMessage(fromNumber, "Usage: `/row <row_no> [sct]`");
                    return;
                }
                
                const query = args[0];
                const targetSheet = args[1] && args[1].toLowerCase() === 'sct' ? 'SCT' : 'TRANSIT';
                const action = command === 'status' ? 'getTruckStatus' : 'getRowDetails';
                
                await client.sendMessage(fromNumber, `🔍 Searching for ${command === 'status' ? 'truck ' + query : 'row ' + query} in ${targetSheet} sheet...`);

                try {
                    const url = new URL(GOOGLE_SCRIPT_URL);
                    url.searchParams.append('action', action);
                    url.searchParams.append('query', query);
                    url.searchParams.append('sheet', targetSheet); // Use 'sheet' to match appscript

                    const response = await fetch(url.toString(), { method: 'GET' });
                    
                    const contentType = response.headers.get('content-type') || '';
                    const responseText = await response.text();

                    if (!contentType.includes('application/json')) {
                        await client.sendMessage(fromNumber, "❌ Google Script returned an unexpected response (not JSON). This may be a temporary error. Admin has been notified.");
                        await notifyAdmin(`*Google Script Unexpected Response:*\nCommand: /${command}\nContent-Type: ${contentType}\nResponse:\n${responseText.substring(0, 300)}`);
                        return;
                    }

                    const result = JSON.parse(responseText);

                    if (result.success && result.data && result.data.length > 0) {
                        let reply = `${result.message}\n\n`;
                        result.data.forEach(row => {
                            let rowSummary = "";
                            if (action === 'getTruckStatus') {
                                const truckKey = Object.keys(row).find(k => k.toLowerCase().includes('truck'));
                                const statusKey = Object.keys(row).find(k => k.toLowerCase().includes('status'));
                                rowSummary = `*Row ${row.ROW_NUMBER}:* ${row[truckKey] || 'N/A'} - Status: ${row[statusKey] || 'N/A'}\n`;
                            } else { // getRowDetails
                                rowSummary = `*Details for Row ${row.ROW_NUMBER}:*\n`;
                                for (const [key, value] of Object.entries(row)) {
                                    if (key !== 'ROW_NUMBER' && value) {
                                        rowSummary += `*${key}:* ${value}\n`;
                                    }
                                }
                            }
                            reply += rowSummary;
                        });
                        await client.sendMessage(fromNumber, reply.trim());
                    } else {
                        await client.sendMessage(fromNumber, `⚠️ ${result.message || 'Could not retrieve information.'}`);
                    }
                } catch (e) {
                    console.error(`Error calling Google Script for /${command}:`, e);
                    await client.sendMessage(fromNumber, "❌ Error connecting to Google Sheets. Admin notified.");
                    await notifyAdmin(`*Google Script Error (${command}):*\n${e.message}`);
                }
                break;
            case 'system':
                const uptime = Math.floor((Date.now() - MESSAGE_STATS.start_time) / 1000);
                const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
                const statusMsg = `*System Status:*\n-----------------\n✅ Bot is connected.\n🕒 Uptime: ${uptimeStr}\n📊 Total Requests: ${MESSAGE_STATS.total_requests}\n📧 Emails Sent: ${MESSAGE_STATS.successful_emails}\n🚫 Emails Failed: ${MESSAGE_STATS.failed_emails}\n⏰ Last Message: ${MESSAGE_STATS.last_message_time ? MESSAGE_STATS.last_message_time.toLocaleString('en-GB', {timeZone: 'Africa/Nairobi'}) : 'N/A'}\n🔧 Session Dir: ${SESSION_DIR}`;
                await client.sendMessage(fromNumber, statusMsg);
                break;
            case 'testpdf':
                await client.sendMessage(fromNumber, "Generating sample PDF...");
                const testData = {
                    reg_no: "KXX123X/ZA456", driver_name: "Test Driver", driver_no: "0700000000",
                    location: "Test Location", email: DEFAULT_RECIPIENTS[0] || "test@example.com",
                    entry_no: "T123", duration: 24, team: "TestTeam"
                };
                try {
                    const pdfBase64 = await generateReportPdf(testData, 'repair');
                    const pdf = new MessageMedia('application/pdf', pdfBase64, 'Test-Repair-Report.pdf');
                    await client.sendMessage(fromNumber, pdf, { caption: "Here is your sample PDF." });
                } catch (e) {
                    console.error("Error generating test PDF:", e);
                    await client.sendMessage(fromNumber, `❌ Failed to generate test PDF: ${e.message}`);
                }
                break;
            case 'newtruck':
                GSWizardSessions[fromNumber] = { step: 'start', data: { fromNumber: fromNumber }, history: [] };
                await client.sendMessage(fromNumber, WIZARD_STEPS.start.message);
                break;
            default:
                await client.sendMessage(fromNumber, `❓ Unknown command: \`/${command}\`. Send /help for available commands.`);
        }
    } catch (error) {
        console.error(`Error handling command /${command} for ${fromNumber}:`, error);
        await client.sendMessage(fromNumber, "❌ An internal error occurred while processing your command. Admin has been notified.");
        await notifyAdmin(`*Command Handling Error:*\nCommand: /${command}\nUser: ${fromNumber}\nError: ${error.message}`);
    }
}

// --- Google Sheet Wizard Input Handler ---
async function handleWizardInput(msg, session) {
    const fromNumber = msg.from;
    const userInput = sanitizeInput(msg.body);
    const currentStepConfig = WIZARD_STEPS[session.step];

    if (!currentStepConfig) {
        console.error(`[Wizard Error] Unknown step: ${session.step} for user ${fromNumber}`);
        delete GSWizardSessions[fromNumber];
        await client.sendMessage(fromNumber, "❌ Wizard error. Please start over with `/newtruck`.");
        return;
    }

    // Validate numeric input more carefully
    if (currentStepConfig.validate === dataValidator.isNumeric) {
        const numValue = parseFloat(userInput);
        if (isNaN(numValue)) {
            await client.sendMessage(fromNumber, "⚠️ Please enter a valid number. Type `cancel` to exit wizard.");
            return;
        }
        // Additional validation for compartment volumes
        if (currentStepConfig.key.startsWith('comp') && (numValue < 0 || numValue > 99999)) {
            await client.sendMessage(fromNumber, "⚠️ Please enter a valid compartment volume (0-99999). Type `cancel` to exit wizard.");
            return;
        }
    }

    try {
        // Store the input after validation
        if (currentStepConfig.key) {
            let valueToStore = userInput;
            if (currentStepConfig.transform) {
                valueToStore = currentStepConfig.transform(userInput);
            }
            if (valueToStore !== undefined) {
                session.data[currentStepConfig.key] = valueToStore;
            }
        }

        // Determine next step
        let nextStepKey = typeof currentStepConfig.next === 'function' 
            ? currentStepConfig.next(session.data)
            : currentStepConfig.next;

        if (nextStepKey && WIZARD_STEPS[nextStepKey]) {
            session.step = nextStepKey;
            const nextStepMessage = typeof WIZARD_STEPS[nextStepKey].message === 'function'
                ? WIZARD_STEPS[nextStepKey].message(session.data)
                : WIZARD_STEPS[nextStepKey].message;
            await client.sendMessage(fromNumber, nextStepMessage);
        } else if (session.step === 'confirm') {
            const confirmMessage = typeof currentStepConfig.message === 'function'
                ? currentStepConfig.message(session.data)
                : currentStepConfig.message;
            await client.sendMessage(fromNumber, confirmMessage);
        }
    } catch (error) {
        console.error("Wizard processing error:", error);
        await client.sendMessage(fromNumber, "❌ Error processing your input. Type `cancel` to exit wizard or try again.");
        await notifyAdmin(`*Wizard Processing Error:*\nUser: ${fromNumber}\nStep: ${session.step}\nError: ${error.message}`);
    }
}

// --- Google Sheet Create Request Handler ---
async function handleGoogleSheetCreateRequest(parseResult, fromNumber) {
    const dataToSend = { ...parseResult.data }; // Clone data
    const action = parseResult.type === 'create_sct' ? 'createSCTEntry' : 'createTransitEntry';
    
    // Remove helper/internal fields before sending to Google Script
    delete dataToSend.fromNumber; 
    delete dataToSend.step;
    delete dataToSend.history;

    await client.sendMessage(fromNumber, `📝 Submitting data for *${dataToSend.truck}* to ${dataToSend.targetSheet || 'Google Sheet'}...`);
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, data: dataToSend })
        });
        const result = await response.json();
        if (result.success) {
            await client.sendMessage(fromNumber, `✅ Success! ${result.message || 'Data submitted to Google Sheet.'}`);
            if (result.rowLink) {
                 await client.sendMessage(fromNumber, `View entry: ${result.rowLink}`);
            }
        } else {
            await client.sendMessage(fromNumber, `⚠️ Error submitting to Google Sheet: ${result.message || 'Unknown error.'}`);
            await notifyAdmin(`*Google Sheet Submit Error:*\nUser: ${fromNumber}\nTruck: ${dataToSend.truck}\nError: ${result.message}`);
        }
    } catch (e) {
        console.error("Error calling Google Script for create request:", e);
        await client.sendMessage(fromNumber, "❌ Error connecting to Google Sheets to submit data. Admin notified.");
        await notifyAdmin(`*Google Script Submit Connection Error:*\nUser: ${fromNumber}\nTruck: ${dataToSend.truck}\nError: ${e.message}`);
    }
}

// --- Repair Request Handler ---
async function handleRepairRequest(data, msg, fromNumber) {
    await client.sendMessage(fromNumber, `🛠️ Processing maintenance report for *${data.reg_no}*...`);
    REPAIR_REQUESTS[data.reg_no] = { ...data, timestamp: new Date(), status: 'pending_pdf' };

    try {
        // 1. Generate PDF
        const pdfBase64 = await generateReportPdf(data, 'repair');
        REPAIR_REQUESTS[data.reg_no].status = 'pdf_generated';

        // 2. Send PDF to user
        const pdfMedia = new MessageMedia('application/pdf', pdfBase64, `RepairReport-${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        await client.sendMessage(fromNumber, pdfMedia, { caption: `Maintenance report for *${data.reg_no}* generated.` });

        // 3. Prepare and send Email
        const emailRecipients = data.email ? [data.email, ...DEFAULT_RECIPIENTS] : DEFAULT_RECIPIENTS;
        const uniqueRecipients = [...new Set(emailRecipients.filter(e => validateEmail(e)))];

        if (uniqueRecipients.length > 0) {
            const emailSubject = `Truck Maintenance Notification: ${data.reg_no}`;
            const emailBody = createRepairEmailBody(data);
            const emailSent = await sendEmailWithAttachment(uniqueRecipients.join(','), emailSubject, emailBody, pdfBase64, `RepairReport-${data.reg_no.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, fromNumber);
            if (emailSent) {
                await client.sendMessage(fromNumber, `📧 Email with PDF sent to: ${uniqueRecipients.join(', ')}`);
                REPAIR_REQUESTS[data.reg_no].status = 'completed';
            } else {
                await client.sendMessage(fromNumber, "⚠️ Failed to send email notification, but PDF was generated.");
                REPAIR_REQUESTS[data.reg_no].status = 'email_failed';
            }
        } else {
            await client.sendMessage(fromNumber, "⚠️ No valid email recipients found. PDF generated but not emailed.");
            REPAIR_REQUESTS[data.reg_no].status = 'no_recipients';
        }
        await notifyAdmin(`Maintenance report processed for ${data.reg_no}. Status: ${REPAIR_REQUESTS[data.reg_no].status}. User: ${fromNumber}`);

    } catch (error) {
        console.error(`Error handling repair request for ${data.reg_no}:`, error);
        REPAIR_REQUESTS[data.reg_no].status = 'error';
        REPAIR_REQUESTS[data.reg_no].error = error.message;
        await client.sendMessage(fromNumber, `❌ Error processing your maintenance report for *${data.reg_no}*. Admin notified. ${error.message}`);
        await notifyAdmin(`*Repair Request Error:*\nReg: ${data.reg_no}\nUser: ${fromNumber}\nError: ${error.message}`);
    }
}

// --- Overnight/Overstay Report Handler ---
async function handleStayReport(data, reportType, msg, fromNumber) {
    const reportTitle = reportType.charAt(0).toUpperCase() + reportType.slice(1);
    await client.sendMessage(fromNumber, `Processing *${reportTitle} Report* for OMC: *${data.omc_name}*...`);

    try {
        // 1. Generate PDF
        const pdfBase64 = await generateReportPdf(data, reportType);

       

        // 2. Send PDF to user
        const pdfMedia = new MessageMedia('application/pdf', pdfBase64, `${reportTitle}Report-${data.omc_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
        await client.sendMessage(fromNumber, pdfMedia, { caption: `${reportTitle} report for *${data.omc_name}* generated.` });
        
        // 3. Prepare and send Email
        const emailRecipients = data.email ? [data.email, ...DEFAULT_RECIPIENTS] : DEFAULT_RECIPIENTS;
        const uniqueRecipients = [...new Set(emailRecipients.filter(e => validateEmail(e)))];

        if (uniqueRecipients.length > 0) {
            const emailSubject = `${reportTitle} Trucks Notification: ${data.omc_name}`;
            const emailBody = createReportEmailBody(data, reportType);
            const emailSent = await sendEmailWithAttachment(uniqueRecipients.join(','), emailSubject, emailBody, pdfBase64, `${reportTitle}Report-${data.omc_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, fromNumber);

            if (emailSent) {
                await client.sendMessage(fromNumber, `📧 Email with PDF sent to: ${uniqueRecipients.join(', ')}`);
            } else {
                await client.sendMessage(fromNumber, "⚠️ Failed to send email notification, but PDF was generated.");
            }
        } else {
            await client.sendMessage(fromNumber, "⚠️ No valid email recipients found. PDF generated but not emailed.");
        }
        await notifyAdmin(`${reportTitle} report processed for ${data.omc_name}. User: ${fromNumber}`);

    } catch (error) {
        console.error(`Error handling ${reportType} report for ${data.omc_name}:`, error);
        await client.sendMessage(fromNumber, `❌ Error processing your *${reportTitle} Report* for *${data.omc_name}*. Admin notified. ${error.message}`);
        await notifyAdmin(`*${reportTitle} Report Error:*\nOMC: ${data.omc_name}\nUser: ${fromNumber}\nError: ${error.message}`);
    }
}

// --- END OF NEW HANDLER FUNCTIONS ---


// --- Graceful Shutdown ---
// (Your existing shutdown function - unchanged)
const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] ${signal} received at ${new Date().toISOString()}. Shutting down gracefully...`);
    const readyBeforeShutdown = isReady;
    isReady = false;                                               
    currentQR = '';
    latestQR = null;
    stopPingInterval();

    // Only notify admin if client is ready and not null
    if (client && readyBeforeShutdown) {
        try {
            await notifyAdmin(`*Bot Shutdown Initiated:*\nReason: Received ${signal}.`);
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            console.error("Error sending shutdown notification:", e?.message);
        }
    } else {
        console.log("Cannot notify admin during shutdown (client not ready/available).");
    }

    // Defensive destroy: only call destroy if client is initialized and has a destroy method
    if (client && typeof client.destroy === 'function') {
        try {
            await client.destroy();
            console.log('WhatsApp client destroyed.');
        } catch (e) {
            console.error('Error destroying WhatsApp client:', e.message || e);
        }
    } else {
        console.log('WhatsApp client not initialized or already destroyed.');
    }

    // Slim: Always exit after cleanup
    setTimeout(() => { process.exit(0); }, 2000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Add process start log and error handlers at the very top ---
console.log(`[BOOT] WhatsApp Bot process started. PID: ${process.pid}, Node version: ${process.version}`);

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
    // Do not exit process, just log for debugging
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
    // Do not exit process, just log for debugging
});    // --- MAIN BOT INITIALIZATION LOGIC ---
// Helper to create client configurations with minimal Chrome args for maximum compatibility
function createClientConfig() {
    return {
        authStrategy: new LocalAuth({ 
            dataPath: SESSION_DIR,
            clientId: 'wpp-bot-client'
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=site-per-process',
                '--disable-features=IsolateOrigins',
                '--disable-features=SingletonLock',
                '--disable-site-isolation-trials',
                '--disable-web-security',
                '--no-first-run',
                '--no-zygote'
            ],
            // Don't specify executablePath - let Puppeteer download/use its own Chrome
            executablePath: null,
            timeout: 180000,  // 3 minutes
            protocolTimeout: 120000  // 2 minutes
        },
        qrMaxRetries: 5,
        qrTimeoutMs: 60000
    };
}

// Function to setup client and register event handlers
function setupClient() {
    console.log('Setting up WhatsApp client and registering event handlers...');
    
    client = new Client(createClientConfig());

    client.on('loading_screen', (percent, message) => {
        console.log(`Loading screen: ${percent}% - ${message}`);
    });

    client.on('launch_failure', (error) => {
        console.error('Browser launch failure:', error);
    });

    client.on('launch_success', (browser) => {
        console.log('Browser launched successfully');
    });

    // QR event handler
    client.on('qr', (qr) => {
        console.log('\n==================================');
        console.log('New QR Code received');
        console.log('QR Length:', qr.length);
        console.log('First 50 chars:', qr.substring(0, 50));
        console.log('==================================\n');
        
        currentQR = qr;
        latestQR = qr;
        
        // Generate terminal QR
        qrcodeTerminal.generate(qr, { small: true });
        
        // Generate data URL
        qrcode.toDataURL(qr)
            .then(url => {
                console.log('QR Data URL generated successfully');
                console.log('Data URL length:', url.length);
            })
            .catch(err => {
                console.error('Error generating QR data URL:', err);
                notifyAdmin(`QR Data URL Generation Error: ${err.message}`).catch(console.error);
            });
    });

    client.on('authenticated', () => {
        console.log('Client Authenticated!');
        currentQR = ''; 
    });

    client.on('auth_failure', async (msg) => {
        console.error('AUTHENTICATION FAILURE:', msg);
        currentQR = '';
        await notifyAdmin(`*Authentication Failure:*\n${msg}\nBot may need to be re-authenticated. If this persists, try removing the session directory (${SESSION_DIR}) and restarting.`);
    });

    client.on('ready', async () => {
        isReady = true;
        currentQR = '';
        console.log(`WhatsApp Client is ready! Bot Name: ${client.info.pushname || 'N/A'}, Number: ${client.info.wid ? client.info.wid.user : 'N/A'}`);
        await notifyAdmin(`*Bot Connected & Ready!*\nName: ${client.info.pushname || 'N/A'}\nNumber: ${client.info.wid ? client.info.wid.user : 'N/A'}`);
        
        if (pendingAdminMessages.length > 0) {
            console.log(`Sending ${pendingAdminMessages.length} pending admin messages...`);
            const messagesToSend = [...pendingAdminMessages];
            pendingAdminMessages = []; // Clear queue before sending to avoid race conditions
            for (const adminMsg of messagesToSend) {
                await notifyAdmin(adminMsg);
            }
        }
        
        initializePing().catch(console.error);
        setupHealthMonitoring(); // Start health monitoring
    });
    
    client.on('disconnected', async (reason) => {
        console.warn('Client was logged out or disconnected!', reason);
        isReady = false;
        currentQR = ''; 
        stopPingInterval();
        await notifyAdmin(`*Bot Disconnected:*\nReason: ${reason}\nBot will attempt to reconnect. A new QR scan might be required.`);
    });

    // The ONLY place for this:
    client.on('message', async (msg) => {
        try {
            MESSAGE_STATS.total_requests++;
            MESSAGE_STATS.last_message_time = new Date();
            const fromNumber = msg.from;
            const body = sanitizeInput(msg.body || "");
            console.log(`[MSG IN ${fromNumber}] Received: "${body.substring(0, 50)}${body.length > 50 ? '...' : ''}"`);
            if (msg.isStatus) return;

            // Process global commands first (these should work even in wizard mode)
            const globalCommands = ['cancel', '/cancel', 'exit', '/exit'];
            if (globalCommands.includes(body.toLowerCase())) {
                if (GSWizardSessions[fromNumber]) {
                    delete GSWizardSessions[fromNumber];
                    await client.sendMessage(fromNumber, "✅ Wizard cancelled. Send `/newtruck` to start again or `/help` for other commands.");
                } else {
                    await client.sendMessage(fromNumber, "No active session to cancel. Send `/help` for available commands.");
                }
                return;
            }

            // Handle active wizard session
            if (GSWizardSessions[fromNumber]) {
                try {
                    await handleWizardInput(msg, GSWizardSessions[fromNumber]);
                } catch (wizardError) {
                    console.error("Wizard handling error:", wizardError);
                    await client.sendMessage(fromNumber, "❌ Error in wizard process. Session cancelled. Type `/newtruck` to start over.");
                    delete GSWizardSessions[fromNumber];
                    await notifyAdmin(`*Wizard Error:*\nUser: ${fromNumber}\nError: ${wizardError.message}`);
                }
                return;
            }

            // Handle commands (now with better error catching)
            if (body.trim().startsWith('/')) {
                try {
                    await handleCommand(body.trim(), fromNumber);
                } catch (cmdError) {
                    console.error("Command handling error:", cmdError);
                    await client.sendMessage(fromNumber, "❌ Error processing command. Please try again or use `/help`.");
                    await notifyAdmin(`*Command Error:*\nUser: ${fromNumber}\nCommand: ${body}\nError: ${cmdError.message}`);
                }
                return;
            }

            // Check for special query patterns without slash
            // Handle "status <truck>" pattern without slash
            const statusMatch = body.trim().match(/^status\s+([A-Za-z0-9\/]+)(\s+sct)?$/i); // Allow / in reg_no
            if (statusMatch) {
                const command = `/status ${statusMatch[1]}${statusMatch[2] ? ' ' + statusMatch[2].trim() : ''}`;
                await handleCommand(command, fromNumber);
                return;
            }

            // Handle "row <number>" pattern without slash
            const rowMatch = body.trim().match(/^row\s+(\d+)(\s+sct)?$/i);
            if (rowMatch) {
                const command = `/row ${rowMatch[1]}${rowMatch[2] ? ' ' + rowMatch[2].trim() : ''}`;
                await handleCommand(command, fromNumber);
                return;
            }

            // Handle "newtruck" without slash (as a convenience)
            if (body.trim().toLowerCase() === 'newtruck') {
                await handleCommand('/newtruck', fromNumber);
                return;
            }

            // Parse the message
            const parseResult = parseTruckRequest(body);

            // Handle greetings
            if (parseResult.status === 'greeting') {
                await sendMainMenu(fromNumber);
                return;
            }

            // Handle Google Sheet data entry (direct message, not wizard)
            if (parseResult.status === 'google_sheet_data') {
                await handleGoogleSheetCreateRequest(parseResult, fromNumber);
                return;
            }

            // Handle incomplete or error from parsing
            if (parseResult.status === 'incomplete') {
                await client.sendMessage(fromNumber, `⚠️ Missing fields: ${parseResult.missing.join(', ')}. Please check the format using /format or use /newtruck for guided entry.`);
                return;
            }
            if (parseResult.status === 'error') {
                await client.sendMessage(fromNumber, `❌ Could not process your message: ${parseResult.message}`);
                return;
            }

            // Handle repair or stay reports from parsing
            if (parseResult.status === 'complete' && parseResult.type === 'repair') {
                await handleRepairRequest(parseResult.data, msg, fromNumber);
                return;
            }
            if (parseResult.status === 'complete' && (parseResult.type === 'overnight' || parseResult.type === 'overstay')) {
                await handleStayReport(parseResult.data, parseResult.type, msg, fromNumber);
                return;
            }

            // Fallback if no other handler caught the message
            await client.sendMessage(fromNumber, "❓ Sorry, I couldn't understand that. Send `/help` for available commands or use `/newtruck` to log a new truck entry.");
        } catch (err) {
            console.error("Error in message handler:", err);
            try {
                await client.sendMessage(msg.from, "❌ Internal error. Admin notified.");
                await notifyAdmin(`*Message Handler Error:*\nFrom: ${msg.from}\nError: ${err.message || err}`);
            } catch (notifyError) {
                console.error("Failed to send error notification:", notifyError);
            }
        }
    });

    return client;
}

// Main initialization function with retries
async function initializeWhatsAppClient() {
    console.log('Initializing WhatsApp client with detailed logging...');
    console.log(`Session directory path: ${SESSION_DIR}`);
    
    // Setup client and register event handlers
    client = setupClient();

    // Try to initialize with retries
    const maxAttempts = 3;
    let attempt = 0;
    
    async function attemptInitialization() {
        attempt++;
        console.log(`Initialization attempt ${attempt}/${maxAttempts}...`);
        
        try {
            await client.initialize();
            console.log(`Client initialized successfully on attempt ${attempt}.`);
            return true;
        } catch (error) {
            console.error(`CLIENT INITIALIZATION ERROR (attempt ${attempt}/${maxAttempts}):`, error);
            
            if (attempt >= maxAttempts) {
                console.error(`All ${maxAttempts} initialization attempts failed.`);
                await notifyAdmin(`*FATAL: Client Initialization Failed*\nAfter ${maxAttempts} attempts.\n${error.message}\nThe bot may not start correctly.`);
                return false;
            }
            
            // Destroy the old client instance
            try {
                if (client && typeof client.destroy === 'function') {
                    await client.destroy();
                }
            } catch (destroyError) {
                console.error('Error destroying client:', destroyError);
            }
            
            // Create a new client instance
            console.log(`Creating new client instance for retry ${attempt + 1}...`);
            client = setupClient();
            
            // Wait before retrying
            const delayMs = 5000 * attempt; // Increase delay with each attempt
            console.log(`Waiting ${delayMs}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            // Try again
            return attemptInitialization();
        }
    }
    
    // Start the initialization process
    return attemptInitialization();
}

// --- Start the bot and Express server ---
initializeWhatsAppClient(); // Call the function to set up and start the client

// Express server setup
app.get('/', (req, res) => {
    console.log(`[WEB] Root endpoint accessed. QR code available: ${currentQR ? 'Yes' : 'No'}. Client ready: ${isReady ? 'Yes' : 'No'}`);
    
    if (currentQR) {
        console.log('[WEB] Serving QR code page to visitor');
        // Enhanced QR code display with auto-refresh
        const html = `
            <html>
                <head>
                    <title>WhatsApp Bot QR Code</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                        .qr-container { margin: 20px auto; max-width: 320px; }
                        .qr-container img { width: 100%; height: auto; border: 1px solid #ddd; }
                        .refresh-timer { font-size: 14px; color: #666; margin-top: 10px; }
                        .status { background: #f0f0f0; padding: 10px; border-radius: 4px; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <h1>WhatsApp Bot QR Code</h1>
                    <div class="status">Status: Waiting for scan</div>
                    <p>Scan this QR code with WhatsApp to connect the bot. This page will refresh automatically.</p>
                    <div class="qr-container">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}" alt="QR Code">
                    </div>
                    <p class="refresh-timer">Page will refresh in <span id="countdown">60</span> seconds</p>
                    <script>
                        // Countdown timer
                        let seconds = 60;
                        const countdownElement = document.getElementById('countdown');
                        const timer = setInterval(() => {
                            seconds--;
                            countdownElement.textContent = seconds;
                            if (seconds <= 0) {
                                clearInterval(timer);
                                window.location.reload();
                            }
                        }, 1000);
                        
                        // Also listen for QR updates via polling
                        const checkQrStatus = setInterval(() => {
                            fetch('/qr-status')
                                .then(res => res.json())
                                .then(data => {
                                    if (data.ready === true) {
                                        clearInterval(checkQrStatus);
                                        document.querySelector('.status').innerHTML = 'Status: <strong style="color:green">Connected!</strong>';
                                        document.querySelector('.status').style.background = '#e6ffe6';
                                        clearInterval(timer);
                                        setTimeout(() => window.location.reload(), 2000);
                                    } else if (data.hasNewQr === true) {
                                        window.location.reload();
                                    }
                                })
                                .catch(err => console.log('Error checking QR status'));
                        }, 3000);
                    </script>
                </body>
            </html>`;
        res.send(html);
    } else if (isReady) {
        console.log('[WEB] Bot is ready, serving connected status page');
        res.send(`
            <html>
                <head>
                    <title>WhatsApp Bot Status</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                        .status { background: #e6ffe6; padding: 15px; border-radius: 4px; margin: 20px 0; color: #006600; }
                    </style>
                </head>
                <body>
                    <h1>WhatsApp Bot Status</h1>
                    <div class="status">✅ Bot is connected and ready!</div>
                    <p>The WhatsApp bot is now connected to the WhatsApp network and is processing messages.</p>
                </body>
            </html>
        `);
    } else {
        console.log('[WEB] Bot not ready, QR not available, serving waiting page');
        res.send(`
            <html>
                <head>
                    <title>WhatsApp Bot Initializing</title>
                    <meta http-equiv="refresh" content="10">
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                        .status { background: #fff4e6; padding: 15px; border-radius: 4px; margin: 20px 0; color: #663300; }
                        .loader { border: 5px solid #f3f3f3; border-top: 5px solid #3498db; border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px auto; }
                        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    </style>
                </head>
                <body>
                    <h1>WhatsApp Bot Initializing</h1>
                    <div class="status">⏳ Waiting for QR code or authentication...</div>
                    <div class="loader"></div>
                    <p>The bot is starting up. This page will refresh automatically every 10 seconds.</p>
                </body>
            </html>
        `);
    }
});

// Add a QR status endpoint for polling
app.get('/qr-status', (req, res) => {
    res.json({
        ready: isReady,
        hasQr: !!currentQR,
        hasNewQr: !!latestQR && latestQR !== currentQR
    });
});

// Add explicit QR code endpoint
app.get('/qr', (req, res) => {
    if (currentQR) {
        console.log('[WEB] Serving dedicated QR code page');
        res.send(`
            <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <meta http-equiv="refresh" content="30">
                </head>
                <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
                    <h2>Scan this QR code with WhatsApp</h2>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}" 
                         alt="QR Code" style="max-width:100%;height:auto;">
                    <p>Page refreshes every 30 seconds. Current time: ${new Date().toLocaleString()}</p>
                </body>
            </html>
        `);
    } else if (isReady) {
        res.redirect('/');
    } else {
        res.send(`
            <html>
                <head>
                    <title>Waiting for QR Code</title>
                    <meta http-equiv="refresh" content="5">
                </head>
                <body style="text-align:center;padding-top:100px;">
                    <h2>Waiting for QR Code to be generated...</h2>
                    <p>Page will refresh automatically. Current time: ${new Date().toLocaleString()}</p>
                </body>
            </html>
        `);
    }
});

app.listen(expressPort, () => {
    console.log(`Server running on port ${expressPort}.`);
    console.log(`- QR code view: http://localhost:${expressPort}/qr`);
    console.log(`- Main status page: http://localhost:${expressPort}/`);
});