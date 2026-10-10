export const environment = {
    production: false,
    // Développement : le serveur de comptes passe aussi par le proxy d'Angular (proxy.conf.json, /userkey)
    // pour que la connexion fonctionne depuis un téléphone sur le Wi-Fi. Ancienne valeur : 'https://userkey.corderapp.be'
    apiUrl: '/userkey',
    // Développement : passe par le proxy d'Angular (proxy.conf.json → http://localhost:5000) pour que
    // l'application fonctionne aussi depuis un téléphone sur le Wi-Fi (http://<IP du PC>:4200).
    // Ancienne valeur : 'http://localhost:5000'
    apiRegistre: '/api-local',
};
