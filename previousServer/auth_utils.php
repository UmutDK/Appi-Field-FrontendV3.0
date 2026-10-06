<?php
/**
 * Fonctions utilitaires pour l'authentification et la gestion des tokens
 * Inclut le système de cache pour éviter le rate limiting
 */

require_once __DIR__ . '/config.php';

function getTokenCacheFilePath() {
    global $baseDir;
    return $baseDir . '.token_cache.json';
}

function loadTokenCacheFromDisk() {
    global $tokenCache;
    $cacheFile = getTokenCacheFilePath();
    
    if (file_exists($cacheFile)) {
        $diskCache = json_decode(file_get_contents($cacheFile), true);
        if (is_array($diskCache)) {
            $tokenCache = array_merge($tokenCache, $diskCache);
        }
    }
}

function saveTokenCacheToDisk() {
    global $tokenCache;
    $cacheFile = getTokenCacheFilePath();
    // Ne garder que les tokens non expirés
    cleanExpiredTokensFromCache();

    // Écriture atomique avec verrou pour éviter la corruption concurrente
    $tmp = $cacheFile . '.tmp';
    $fpw = fopen($tmp, 'wb');
    if ($fpw) {
        $writeSuccess = false;
        if (flock($fpw, LOCK_EX)) {
            $writeSuccess = fwrite($fpw, json_encode($tokenCache, JSON_PRETTY_PRINT)) !== false;
            fflush($fpw);
            flock($fpw, LOCK_UN);
        }
        fclose($fpw);
        
        // Vérifier que le fichier temporaire existe avant de le renommer
        if ($writeSuccess && file_exists($tmp)) {
            if (!rename($tmp, $cacheFile)) {
                // Nettoyage et fallback
                if (file_exists($tmp)) {
                    unlink($tmp);
                }
                file_put_contents($cacheFile, json_encode($tokenCache, JSON_PRETTY_PRINT));
            }
        } else {
            // Nettoyage du fichier temporaire défaillant
            if (file_exists($tmp)) {
                unlink($tmp);
            }
            // Fallback sur l'écriture directe
            file_put_contents($cacheFile, json_encode($tokenCache, JSON_PRETTY_PRINT));
        }
    } else {
        file_put_contents($cacheFile, json_encode($tokenCache, JSON_PRETTY_PRINT));
    }
}

function cleanExpiredTokensFromCache() {
    global $tokenCache, $cacheTimeout;
    $currentTime = time();
    
    foreach ($tokenCache as $cacheKey => $cached) {
        if ($currentTime - $cached['timestamp'] >= $cacheTimeout) {
            unset($tokenCache[$cacheKey]);
        }
    }
}

function getUserIdFromToken($token) {
    global $tokenCache, $cacheTimeout;
        
    // Rejeter les valeurs manifestement invalides (chaînes "null"/"undefined" envoyées par JS)
    if (empty($token) || $token === 'null' || $token === 'undefined') {
        return null;
    }
    
    // Vérifier le cache d'abord
    $cacheKey = md5($token);
    if (isset($tokenCache[$cacheKey])) {
        $cached = $tokenCache[$cacheKey];
        if (time() - $cached['timestamp'] < $cacheTimeout) {
            return $cached['user_id'];
        } else {
            // Cache expiré
            unset($tokenCache[$cacheKey]);
        }
    }
    
    // Vérification du token via API
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
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error || $httpCode !== 200) {
        return null;
    }
    
    // Décoder la réponse JSON
    $userData = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || !isset($userData['Id_User'])) {
        return null;
    }
    
    // Mettre en cache le résultat
    $tokenCache[$cacheKey] = [
        'user_id' => $userData['Id_User'],
        'timestamp' => time(),
        'user_info' => [
            'nom' => $userData['Nom'] ?? '',
            'prenom' => $userData['Prenom'] ?? '',
            'mail' => $userData['Mail'] ?? ''
        ]
    ];
    
    saveTokenCacheToDisk();
    return $userData['Id_User'];
}

function getTokenFromRequest() {
    // 1. Header Authorization
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    
    if (!$authHeader && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? null;
    }
    
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        $token = substr($authHeader, 7);
        return $token;
    }
    
    // 2. Paramètre GET
    if (isset($_GET['token'])) {
        return $_GET['token'];
    }
    
    // 3. Body POST/PUT
    if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        if (isset($data['token'])) {
            return $data['token'];
        }
    }
    
    return null;
}

function authenticateAndGetUserId() {
    $token = getTokenFromRequest();
    if (!$token) {
        return null;
    }

    return getUserIdFromToken($token);
}

/**
 * Récupère le mail d'un utilisateur depuis le cache de tokens (déjà chargé en mémoire).
 * Retourne une chaîne vide si introuvable.
 */
function getUserMailFromCache(string $userId): string {
    global $tokenCache;
    foreach ($tokenCache as $cached) {
        if (($cached['user_id'] ?? '') === $userId) {
            return $cached['user_info']['mail'] ?? '';
        }
    }
    return '';
}

/**
 * Résout l'id_user effectif à utiliser pour filtrer les données.
 * Si le header X-Workspace-UserId est présent ET qu'un mandat accepté existe
 * entre l'utilisateur connecté (mandaté) et le propriétaire (owner),
 * retourne l'id du propriétaire. Sinon retourne l'id du user connecté.
 *
 * @param string $baseDir  Chemin de base du serveur
 * @return string|null     L'id_user à utiliser, ou null si non authentifié
 */
function resolveWorkspaceUserId(string $baseDir): ?string {
    $realUserId = authenticateAndGetUserId();
    if (!$realUserId) return null;

    // Lire le header X-Workspace-UserId
    $workspaceUserId = $_SERVER['HTTP_X_WORKSPACE_USERID'] ?? null;
    if (!$workspaceUserId || $workspaceUserId === $realUserId) {
        return $realUserId;
    }

    // Vérifier qu'un mandat accepté existe :
    // - owner_user_id   = $realUserId       (le user connecté, qui a créé la demande)
    // - mandate_user_id = $workspaceUserId  (l'utilisateur dont on consulte les données)
    $mandatsFile = $baseDir . 'mandats/mandats.json';
    if (!file_exists($mandatsFile)) return $realUserId;

    $mandats = json_decode(file_get_contents($mandatsFile), true);
    if (!is_array($mandats)) return $realUserId;

    foreach ($mandats as $m) {
        if (($m['statut'] ?? '') !== 'accepted') continue;

        // Je suis MANDATÉ → j'accède aux données du owner (owner_user_id = workspaceUserId)
        if (
            ($m['mandate_user_id'] ?? '') === $realUserId
            && ($m['owner_user_id'] ?? '') === $workspaceUserId
        ) {
            return $workspaceUserId;
        }
    }

    // Mandat introuvable ou non accepté → on reste sur le vrai user
    return $realUserId;
}
?>
