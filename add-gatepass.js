// Add gatepass count to summaries
const fs = require('fs');
const botFilePath = 'C:/Users/issad/Desktop/tlg/api/bot.js';

// Read file
let code = fs.readFileSync(botFilePath, 'utf8');

// First instance
let pattern1 = 'if (trucks.length > 1) {\n                    const exitedCount = trucks.filter(t => t[\'KPC EXIT\'] || t.kpc_exit).length;\n                    const armedCount = trucks.filter(t => {\n                        const arming = t.ARMING || t.arming || \'\';\n                        return arming && arming.toLowerCase().includes(\'ok\');\n                    }).length;';

let replacement1 = 'if (trucks.length > 1) {\n                    const exitedCount = trucks.filter(t => t[\'KPC EXIT\'] || t.kpc_exit).length;\n                    const armedCount = trucks.filter(t => {\n                        const arming = t.ARMING || t.arming || \'\';\n                        return arming && arming.toLowerCase().includes(\'ok\');\n                    }).length;\n                    const gatepassCount = trucks.filter(t => t.GATEPASS || t.gatepass).length;';

code = code.replace(new RegExp(pattern1.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replacement1);

// Second instance
let pattern2 = 'reply += ` Total trucks: ${trucks.length}\\n`;\n                    if (exitedCount > 0) reply += ` Exited KPC: ${exitedCount}\\n`;';

let replacement2 = 'reply += ` Total trucks: ${trucks.length}\\n`;\n                    if (gatepassCount > 0) reply += ` Gatepass issued: ${gatepassCount}\\n`;\n                    if (exitedCount > 0) reply += ` Exited KPC: ${exitedCount}\\n`;';

code = code.replace(new RegExp(pattern2.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replacement2);

// Write back to file
fs.writeFileSync(botFilePath, code, 'utf8');
console.log('Gatepass count added to summary sections');
