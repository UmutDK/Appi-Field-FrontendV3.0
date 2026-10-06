<?php
/**
 * Configuration centralisée — détecte l'environnement selon le domaine du serveur.
 * Ajouter ce fichier sur chaque serveur ou l'adapter manuellement si nécessaire.
 */

$host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';

// Guard contre les double-includes (define() fatal en PHP 8 si constant déjà définie)
if (!defined('USERKEY_BASE_URL')) {
    // strpos() utilisé à la place de str_contains() pour compatibilité PHP 7.x
    if (strpos($host, 'dev') !== false || strpos($host, 'localhost') !== false) {
        // Environnement de développement
        define('USERKEY_BASE_URL', 'https://userkeydev.corderapp.be');
    } else {
        // Environnement de production
        define('USERKEY_BASE_URL', 'https://userkey.corderapp.be');
    }
    define('USERKEY_VERIFY_URL', USERKEY_BASE_URL . '/controllers/verification_token.php');
}

// Intégration WalleSmart (vérification de liaison de compte)
// Auth : token de session de l'utilisateur connecté (pas de secret serveur ici).
if (!defined('WES_CHECK_MAIL_URL')) {
    define('WES_CHECK_MAIL_URL', USERKEY_BASE_URL . '/controllers/wallesmart/check_mail.php');
}
