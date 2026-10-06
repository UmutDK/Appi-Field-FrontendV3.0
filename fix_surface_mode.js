const fs = require("fs");
const path = require("path");
const htmlPath = path.join(__dirname, "src/app/registre/components/traitement-phyto/traitement-phyto.component.html");
let content = fs.readFileSync(htmlPath, "utf8");

const idx = content.indexOf("Surface totale");
const lineStart = content.lastIndexOf("\n", idx) + 1;
const line = content.substring(lineStart, content.indexOf("\n", idx));
const chars = [...line.substring(line.indexOf("totale") + 6, line.indexOf("totale") + 12)].map(c => c.charCodeAt(0));
console.log("Char codes after 'totale':", chars);

content = content.replace(/<small class="rep-total-hint">Surface totale[^<]*<\/small>/g, function(m) {
  return m.replace(/Surface totale[^{]*(\{\{[\s\S]*?\}\})\s+(\{\{[^}]*\}\})\s+total<\/small>/, "/ $1 $2 total</small>");
});
console.log("Surface totale remaining:", (content.match(/Surface totale/g) || []).length);
console.log("rep-pct-badge count:", (content.match(/rep-pct-badge/g) || []).length);
fs.writeFileSync(htmlPath, content, "utf8");
console.log("Saved.");