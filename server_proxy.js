const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.raw());
app.use(express.text());

// Proxy pour l'API PHP
app.all('/server/*', (req, res) => {
  const phpScriptPath = path.join(__dirname, 'server', 'index.php');
  const queryString = req.url.split('?')[1] || '';
  
  // Construire la commande PHP
  let phpCommand = `php "${phpScriptPath}"`;
  
  // Variables d'environnement pour simuler la requête HTTP
  const env = {
    ...process.env,
    REQUEST_METHOD: req.method,
    QUERY_STRING: queryString,
    CONTENT_TYPE: req.headers['content-type'] || '',
    HTTP_HOST: req.headers.host || 'localhost:3000'
  };
  
  const phpProcess = exec(phpCommand, { env }, (error, stdout, stderr) => {
    if (error) {
      console.error('Erreur PHP:', error);
      res.status(500).json({ error: 'Erreur serveur PHP', details: error.message });
      return;
    }
    
    if (stderr) {
      console.error('Stderr PHP:', stderr);
    }
    
    try {
      // Essayer de parser la sortie JSON
      const result = JSON.parse(stdout);
      res.json(result);
    } catch (e) {
      // Si ce n'est pas du JSON, renvoyer tel quel
      res.send(stdout);
    }
  });
  
  // Envoyer les données POST/PUT au processus PHP
  if (req.method === 'POST' || req.method === 'PUT') {
    const data = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    phpProcess.stdin.write(data);
    phpProcess.stdin.end();
  }
});

app.listen(port, () => {
  console.log(`Serveur proxy PHP démarré sur http://localhost:${port}`);
  console.log('Vous pouvez maintenant tester l\'API PHP via Angular');
});
