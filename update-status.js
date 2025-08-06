// Script to add sheet recognition to status commands
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const botFilePath = path.join(__dirname, 'api', 'bot.js');

console.log(`Reading file: ${botFilePath}`);
let code = fs.readFileSync(botFilePath, 'utf8');
console.log(`File loaded: ${code.length} bytes`);

// Function to process both status command handlers
function updateStatusHandler(commandRegex, newImplementation) {
    const commandMatch = code.match(commandRegex);
    if (!commandMatch) {
        console.log(`Command pattern not found: ${commandRegex}`);
        return false;
    }
    
    // Replace the command implementation
    code = code.replace(commandRegex, newImplementation);
    return true;
}

// Update the /status command handler
const statusCommandRegex = /bot\.command\('status', async \(ctx\) => \{\s+const args = ctx\.message\.text\.split\(' '\);\s+if \(args\.length < 2\) return ctx\.reply\('Usage: \/status <truckNo>'\);\s+const truck = args\.slice\(1\)\.join\(' '\);\s+try \{\s+\/\/ Add confirmation message\s+await ctx\.reply\(`🔍 Searching for truck status: "\$\{truck\}"\.\.\.`\);\s+\s+const url = `\$\{SCRIPT_URL\}\?action=getTruckStatus&sheet=TRANSIT&query=\$\{encodeURIComponent\(truck\)\}`;/;

const newStatusCommand = `bot.command('status', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Usage: /status <truckNo> [sheet]');
  
  // Parse input to check for sheet name
  let truck = '';
  let sheet = 'TRANSIT'; // Default sheet
  
  // Check if the last argument is a sheet name
  const knownSheets = ['TRANSIT', 'SCT', 'ENTRIES'];
  if (args.length > 2 && knownSheets.includes(args[args.length-1].toUpperCase())) {
    sheet = args[args.length-1].toUpperCase();
    truck = args.slice(1, args.length-1).join(' ');
  } else {
    truck = args.slice(1).join(' ');
  }
  
  try {
    // Add confirmation message with sheet information
    await ctx.reply(\`🔍 Searching for truck "\${truck}" in \${sheet} sheet...\`);
    
    const url = \`\${SCRIPT_URL}?action=getTruckStatus&sheet=\${sheet}&query=\${encodeURIComponent(truck)}\`;`;

// Update the plain text status handler
const hearsStatusRegex = /bot\.hears\(\/\^status\\s\+\(\.\+\)\/i, async \(ctx\) => \{\s+const truck = ctx\.match\[1\]\.trim\(\);\s+try \{\s+\/\/ Add confirmation message\s+await ctx\.reply\(`🔍 Searching for truck status: "\$\{truck\}"\.\.\.`\);\s+\s+const url = `\$\{SCRIPT_URL\}\?action=getTruckStatus&sheet=TRANSIT&query=\$\{encodeURIComponent\(truck\)\}`;/;

const newHearsStatus = `bot.hears(/^status\\s+(.+)/i, async (ctx) => {
  const input = ctx.match[1].trim();
  
  // Parse input to check for sheet name
  let truck = '';
  let sheet = 'TRANSIT'; // Default sheet
  
  // Check if the input contains a sheet name
  const knownSheets = ['TRANSIT', 'SCT', 'ENTRIES'];
  const parts = input.split(' ');
  
  if (parts.length > 1 && knownSheets.includes(parts[parts.length-1].toUpperCase())) {
    sheet = parts[parts.length-1].toUpperCase();
    truck = parts.slice(0, parts.length-1).join(' ');
  } else {
    truck = input;
  }
  
  try {
    // Add confirmation message with sheet information
    await ctx.reply(\`🔍 Searching for truck "\${truck}" in \${sheet} sheet...\`);
    
    const url = \`\${SCRIPT_URL}?action=getTruckStatus&sheet=\${sheet}&query=\${encodeURIComponent(truck)}\`;`;

// Apply changes
let commandsUpdated = 0;

if (updateStatusHandler(statusCommandRegex, newStatusCommand)) {
    commandsUpdated++;
    console.log("Updated /status command handler");
}

if (updateStatusHandler(hearsStatusRegex, newHearsStatus)) {
    commandsUpdated++;
    console.log("Updated plain text status handler");
}

console.log(`Updated ${commandsUpdated} handlers.`);

// Write the updated file
fs.writeFileSync(botFilePath, code, 'utf8');
console.log(`File updated: ${botFilePath}`);
