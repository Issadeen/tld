// Verify that changes have been made
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const botFilePath = path.join(__dirname, 'api', 'bot.js');

console.log(`Reading file: ${botFilePath}`);
let code = fs.readFileSync(botFilePath, 'utf8');
console.log(`File loaded: ${code.length} bytes`);

// Check for gatepass count calculation
const gatepassCountPattern = /const gatepassCount = trucks\.filter\(t => t\.GATEPASS \|\| t\.gatepass\)\.length;/g;
const gatepassCountMatches = code.match(gatepassCountPattern) || [];
console.log(`Found ${gatepassCountMatches.length} gatepass count calculations`);

// Check for gatepass in summary
const gatepassInSummaryPattern = /if \(gatepassCount > 0\) reply \+= `• Gatepass issued: \$\{gatepassCount\}\\n`;/g;
const gatepassInSummaryMatches = code.match(gatepassInSummaryPattern) || [];
console.log(`Found ${gatepassInSummaryMatches.length} gatepass summary lines`);

// Check for status confirmation messages
const statusConfirmPattern = /🔍 Searching for truck status:/g;
const statusConfirmMatches = code.match(statusConfirmPattern) || [];
console.log(`Found ${statusConfirmMatches.length} status confirmation messages`);

// Check for tanker image path fix
const tankerImagePathPattern = /const TANKER_IMAGE_PATH =/g;
const tankerImagePathMatches = code.match(tankerImagePathPattern) || [];
console.log(`Found ${tankerImagePathMatches.length} tanker image path fixes`);

// Check for reserved words list (SCT, ROW)
const reservedWordsPattern = /const reservedWords = \['SCT', 'ROW'\];/g;
const reservedWordsMatches = code.match(reservedWordsPattern) || [];
console.log(`Found ${reservedWordsMatches.length} reserved words lists`);
