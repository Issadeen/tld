// Summary fix: Find all summaries and add gatepass count
const fs = require('fs');
const path = require('path');

// Read the file
const filePath = path.resolve('C:/Users/issad/Desktop/tlg/api/bot.js');
let content = fs.readFileSync(filePath, 'utf8');

// Regular expression to find summary sections
const summaryRegex = /(const armedCount = trucks\.filter\(t => \{\s+const arming = t\.ARMING \|\| t\.arming \|\| '';\s+return arming && arming\.toLowerCase\(\)\.includes\('ok'\);\s+\}\)\.length;)(\s+reply \+= ` \*Summary:\*\\n`;)/g;

// Add gatepassCount after armedCount
const replacement = '$1\n                    const gatepassCount = trucks.filter(t => t.GATEPASS || t.gatepass).length;$2';
content = content.replace(summaryRegex, replacement);

// Regular expression to find the part where we output the summary info
const summaryOutputRegex = /(reply \+= ` Total trucks: \${trucks\.length}\\n`;)(\s+if \(exitedCount > 0\) reply \+= ` Exited KPC: \${exitedCount}\\n`;)/g;

// Add gatepass count to the summary
const outputReplacement = '$1\n                    if (gatepassCount > 0) reply += ` Gatepass issued: ${gatepassCount}\\n`;$2';
content = content.replace(summaryOutputRegex, outputReplacement);

// Write the updated content back to the file
fs.writeFileSync(filePath, content, 'utf8');
console.log('Summary sections updated to include gatepass count');
