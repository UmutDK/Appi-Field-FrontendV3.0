<?php
/**
 * Proxy de validation de token — évite les appels CORS directs depuis Angular vers userkey.
 * Redirige la vérification vers userkey.corderapp.be via cURL (serveur-à-serveur).
 * Retourne la même structure JSON que verification_token.php.
 */

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");
header("Cache-Control: no-cache");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

require_once __DIR__ . '/auth_utils.php';
require_once __DIR__ . '/response_utils.php';

// Récupérer le token depuis Authorization header ou query param
$token = null;

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
if (!$authHeader && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $authHeader = $headers['Authorization'] ?? null;
}
if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
    $token = substr($authHeader, 7);
}
if (!$token && isset($_GET['token'])) {
    $token = $_GET['token'];
}

if (empty($token)) {
    http_response_code(401);
    echo json_encode(['error' => 'Token manquant']);
    exit();
}

// Appel vers userkey via cURL (pas de CORS, serveur-à-serveur)
$url = USERKEY_VERIFY_URL . "?token=" . urlencode($token);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error    = curl_error($ch);
curl_close($ch);

if ($error || $httpCode !== 200) {
    http_response_code(502);
    echo json_encode(['error' => 'Service d\'authentification inaccessible']);
    exit();
}

$data = json_decode($response, true);
if (json_last_error() !== JSON_ERROR_NONE || empty($data)) {
    http_response_code(502);
    echo json_encode(['error' => 'Réponse invalide du service d\'authentification']);
    exit();
}

http_response_code(200);
echo json_encode($data);
