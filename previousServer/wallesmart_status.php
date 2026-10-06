<?php
/**
 * Statut de liaison WalleSmart du compte connecté.
 * GET wallesmart_status.php → { "linked": true|false, "mail": "..." }
 */

require_once __DIR__ . '/auth_utils.php';
require_once __DIR__ . '/response_utils.php';
require_once __DIR__ . '/wallesmart_utils.php';

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");
header("Cache-Control: no-cache");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$GLOBALS['tokenCache'] = isset($GLOBALS['tokenCache']) ? $GLOBALS['tokenCache'] : [];
$GLOBALS['cacheTimeout'] = 1800;
$baseDir = __DIR__ . '/';
loadTokenCacheFromDisk();

$token = getTokenFromRequest();
if (!$token) {
    http_response_code(401);
    echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
    exit();
}

$userId = getUserIdFromToken($token);
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
    exit();
}

$userMail = getUserMailFromCache($userId);
if (empty($userMail)) {
    http_response_code(200);
    echo json_encode(['linked' => false, 'mail' => null]);
    exit();
}

// check_mail.php exige le token de session de l'utilisateur lui-même (pas un secret serveur)
$linked = checkWallesmartLinked($userMail, $token);

http_response_code(200);
echo json_encode(['linked' => $linked, 'mail' => $userMail], JSON_UNESCAPED_UNICODE);
