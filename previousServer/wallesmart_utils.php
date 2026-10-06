<?php
/**
 * Fonctions utilitaires pour l'intégration WalleSmart (WES).
 * Vérifie si un email est déjà lié à un compte WalleSmart via l'API UserKey.
 */

require_once __DIR__ . '/config.php';

/**
 * Vérifie auprès de UserKey si $mail (celui de l'utilisateur authentifié par $userToken)
 * est lié à un compte WalleSmart. L'auth se fait avec le token de session de l'utilisateur
 * lui-même (pas un secret serveur) — check_mail.php exige que $mail corresponde exactement
 * au compte identifié par ce token, sinon 403.
 * Retourne false en cas d'erreur réseau/réponse invalide (fail-safe).
 */
function checkWallesmartLinked(string $mail, string $userToken): bool {
    if (empty($mail) || empty($userToken)) {
        return false;
    }

    $url = WES_CHECK_MAIL_URL . '?mail=' . urlencode($mail);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Authorization: Bearer ' . $userToken]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode !== 200 || !$response) {
        return false;
    }

    $data = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return false;
    }

    return ($data['data']['exists'] ?? false) === true;
}
?>
