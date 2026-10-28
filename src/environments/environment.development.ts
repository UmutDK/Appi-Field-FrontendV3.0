export const environment = {
    production: false,
    apiUrl: 'https://userkey.corderapp.be',
    apiRegistre: 'http://localhost:5000',
    // Référentiels Phytoweb (/index/*, publics, lecture seule) : la base locale ne contient pas
    // les tables corderPhytoweb, on passe donc par le proxy ng serve vers l'API de prod
    // (cf. proxy.conf.json, contourne le CORS qui n'autorise pas localhost).
    apiPhytoweb: '/phytoweb-api',
};
