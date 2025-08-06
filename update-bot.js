// Script to update bot.js with required changes
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const botFilePath = path.join(__dirname, 'api', 'bot.js');

console.log(`Reading file: ${botFilePath}`);
let code = fs.readFileSync(botFilePath, 'utf8');
console.log(`File loaded: ${code.length} bytes`);

// Since we're having trouble with regex patterns, let's use a different approach
// Find all occurrences of where we need to add the gatepass count calculation
let addedGatepassCount = 0;
let addedToSummary = 0;

// Replace the calculation part
code = code.replace(/const armedCount = trucks\.filter\(t => \{\s+const arming = t\.ARMING \|\| t\.arming \|\| '';\s+return arming && arming\.toLowerCase\(\)\.includes\('ok'\);\s+\}\)\.length;/g, (match) => {
    addedGatepassCount++;
    return match + "\n                    const gatepassCount = trucks.filter(t => t.GATEPASS || t.gatepass).length;";
});

// Replace the summary part
code = code.replace(/reply \+= `• Total trucks: \$\{trucks\.length\}\\n`;/g, (match) => {
    addedToSummary++;
    return match + "\n                    if (gatepassCount > 0) reply += `• Gatepass issued: ${gatepassCount}\\n`;";
});

console.log(`Added gatepass count calculation in ${addedGatepassCount} places.`);
console.log(`Added gatepass to summary in ${addedToSummary} places.`);

// Write the updated file
fs.writeFileSync(botFilePath, code, 'utf8');
console.log(`File updated: ${botFilePath}`);
