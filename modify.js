// Script to add gatepass to summary
const fs = require('fs');
const path = require('path');

try {
  const filePath = path.resolve(__dirname, 'api/bot.js');
  console.log(`Reading file: ${filePath}`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  console.log(`File read, length: ${content.length}`);
  
  // Add gatepass code in both summary sections
  const newContent = content.replace(
    /const armedCount = trucks\.filter\(t => \{\s+const arming = t\.ARMING \|\| t\.arming \|\| '';\s+return arming && arming\.toLowerCase\(\)\.includes\('ok'\);\s+\}\)\.length;(\s+reply \+= `📊 \*Summary:\*\\n`;)/g,
    "const armedCount = trucks.filter(t => {\n                        const arming = t.ARMING || t.arming || '';\n                        return arming && arming.toLowerCase().includes('ok');\n                    }).length;\n                    const gatepassCount = trucks.filter(t => t.GATEPASS || t.gatepass).length;$1"
  );
  
  // Add gatepass to the output section
  const finalContent = newContent.replace(
    /(reply \+= `• Total trucks: \${trucks\.length}\\n`;)(\s+if \(exitedCount > 0\) reply \+= `• Exited KPC: \${exitedCount}\\n`;)/g,
    "$1\n                    if (gatepassCount > 0) reply += `• Gatepass issued: ${gatepassCount}\\n`;$2"
  );
  
  fs.writeFileSync(filePath, finalContent, 'utf8');
  console.log('Gatepass summary added successfully');
} catch (error) {
  console.error('Error updating file:', error);
}
