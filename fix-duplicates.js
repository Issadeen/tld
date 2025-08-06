// Fix duplicate lines
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const botFilePath = path.join(__dirname, 'api', 'bot.js');

console.log(`Reading file: ${botFilePath}`);
let code = fs.readFileSync(botFilePath, 'utf8');
console.log(`File loaded: ${code.length} bytes`);

// Fix duplicate gatepass lines
code = code.replace(/if \(gatepassCount > 0\) reply \+= `• Gatepass issued: \$\{gatepassCount\}\\n`;\s+if \(gatepassCount > 0\) reply \+= `• Gatepass issued: \$\{gatepassCount\}\\n`;/g, 
    'if (gatepassCount > 0) reply += `• Gatepass issued: ${gatepassCount}\\n`;');

// Write the updated file
fs.writeFileSync(botFilePath, code, 'utf8');
console.log(`File updated: ${botFilePath}`);
