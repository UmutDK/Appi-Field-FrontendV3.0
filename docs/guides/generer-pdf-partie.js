// Génère le PDF de relecture d'une partie du guide complet (à imprimer pour vérification).
// Usage : node docs/guides/generer-pdf-partie.js <partie>     ex. : node docs/guides/generer-pdf-partie.js 1
//         node docs/guides/generer-pdf-partie.js liste        → affiche les parties disponibles
// Résultat : docs/guides/relecture/Partie-<n>-<titre>.pdf (+ le .html correspondant)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Partie → chapitres (id des <section> de guide-complet.html). À compléter au fil de la rédaction.
const PARTIES = {
  0: { titre: 'Introduction', fichier: 'introduction', chapitres: ['c1'] },
  1: { titre: 'Inscription et connexion', fichier: 'inscription-connexion', chapitres: ['c2'] },
  2: { titre: 'Accueil et navigation', fichier: 'accueil-navigation', chapitres: ['c3', 'c4'] },
  3: { titre: 'Mes parcelles', fichier: 'parcelles', chapitres: ['c5'] },
  4: { titre: 'Ma carte', fichier: 'ma-carte', chapitres: ['c6'] },
  5: { titre: 'Le carnet de champ et les cultures', fichier: 'cultures', chapitres: ['c7'] },
};

const DIR = __dirname;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const arg = process.argv[2];
if (!arg || arg === 'liste') {
  for (const [n, p] of Object.entries(PARTIES)) console.log(`${n}  ${p.titre}  (${p.chapitres.join(', ')})`);
  process.exit(0);
}
const partie = PARTIES[arg];
if (!partie) { console.error(`Partie inconnue : ${arg}. Lancez avec « liste ».`); process.exit(1); }

const source = fs.readFileSync(path.join(DIR, 'guide-complet.html'), 'utf8');
const sections = partie.chapitres.map((id, i) => {
  const m = source.match(new RegExp(`<section class="chapter[^"]*" id="${id}">[\\s\\S]*?</section>`));
  if (!m) throw new Error(`Chapitre ${id} introuvable dans guide-complet.html`);
  // Premier chapitre : pas de saut de page avant ; images relatives au dossier relecture/.
  return (i === 0 ? m[0].replace('class="chapter', 'class="chapter first') : m[0]).replace(/src="captures\//g, 'src="../captures/');
}).join('\n\n');

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>Appi'Field – Relecture partie ${arg} : ${partie.titre}</title>
<link rel="stylesheet" href="../guide.css" />
<style>
  @page { @bottom-right { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #5b6575; } }
</style>
</head>
<body>
${sections}

</body>
</html>`;

const outDir = path.join(DIR, 'relecture');
fs.mkdirSync(outDir, { recursive: true });
const base = `Partie-${arg}-${partie.fichier}`;
const htmlPath = path.join(outDir, base + '.html');
const pdfPath = path.join(outDir, base + '.pdf');
fs.writeFileSync(htmlPath, html, 'utf8');

if (!CHROME) { console.error('Chrome ou Edge introuvable : ouvrez ' + htmlPath + ' et imprimez-le en PDF.'); process.exit(1); }
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, 'file:///' + htmlPath.replace(/\\/g, '/')], { stdio: 'ignore' });
console.log('PDF créé : ' + pdfPath);
