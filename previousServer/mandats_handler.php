<?php
/**
 * Gestionnaire des mandats inter-utilisateurs
 * Permet à un utilisateur (A) de donner accès à ses données à un autre utilisateur (B).
 *
 * Routes :
 *   GET    mandats_handler.php                          → mandats du user connecté (owner + mandaté)
 *   POST   mandats_handler.php                          → créer une demande de mandat vers un mail
 *   PUT    mandats_handler.php?mandat_id=xxx            → accepter / refuser / supprimer un mandat
 *   DELETE mandats_handler.php?mandat_id=xxx            → supprimer un mandat (owner ou mandaté)
 */

require_once __DIR__ . '/auth_utils.php';
require_once __DIR__ . '/response_utils.php';
require_once __DIR__ . '/file_utils.php';

// ── En-têtes CORS ────────────────────────────────────────────────────────────
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Workspace-UserId");
header("Content-Type: application/json; charset=UTF-8");
header("Cache-Control: no-cache");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Charger le cache de tokens (réutilise le système existant)
$GLOBALS['tokenCache'] = isset($GLOBALS['tokenCache']) ? $GLOBALS['tokenCache'] : [];
$GLOBALS['cacheTimeout'] = 1800;
$baseDir = __DIR__ . '/';
loadTokenCacheFromDisk();

// ── Authentification ─────────────────────────────────────────────────────────
$userId = authenticateAndGetUserId();
if (!$userId) {
    http_response_code(401);
    echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
    exit();
}

// ── Récupérer le mail du user connecté depuis le cache de tokens ─────────────
$userMail = getUserMailFromCache($userId);

// ── Chemin du fichier de données ─────────────────────────────────────────────
$mandatsDir  = $baseDir . 'mandats/';
$mandatsFile = $mandatsDir . 'mandats.json';

// Créer le dossier si nécessaire
if (!is_dir($mandatsDir)) {
    mkdir($mandatsDir, 0755, true);
}

// Créer le fichier s'il n'existe pas
if (!file_exists($mandatsFile)) {
    file_put_contents($mandatsFile, json_encode([], JSON_PRETTY_PRINT));
}

// ── Lecture des mandats ───────────────────────────────────────────────────────
function readMandats(string $path): array {
    $content = file_get_contents($path);
    if (!$content || trim($content) === '') return [];
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function writeMandats(string $path, array $data): void {
    $tmp = $path . '.tmp';
    $fp  = fopen($tmp, 'wb');
    if ($fp) {
        flock($fp, LOCK_EX);
        fwrite($fp, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        rename($tmp, $path);
    } else {
        file_put_contents($path, json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
}

/**
 * Récupère le nom de l'exploitation d'un utilisateur.
 * Lit exploitation/exploitations.json et retourne le nom de l'exploitation.
 */
function getExploitationName(string $userId, string $baseDir): string {
    $path = $baseDir . 'exploitation/exploitations.json';
    if (!file_exists($path)) return '';
    $data = json_decode(file_get_contents($path), true);
    if (!is_array($data)) return '';
    foreach ($data as $entry) {
        if (($entry['id_user'] ?? '') === $userId) {
            return $entry['name'] ?? $entry['nomDeMonExploitation'] ?? '';
        }
    }
    return '';
}

/**
 * Trouve un id_user à partir d'un mail en parcourant le cache de tokens.
 * Retourne null si inconnu dans le cache (pas encore connecté depuis ce serveur).
 */
function findUserIdByMail(string $mail, array $tokenCache): ?string {
    foreach ($tokenCache as $cached) {
        if (strtolower($cached['user_info']['mail'] ?? '') === strtolower($mail)) {
            return $cached['user_id'];
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET – Retourner les mandats du user connecté (owner OU mandaté)
// ─────────────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mandats = readMandats($mandatsFile);
    $userMailLower = strtolower($userMail);

    // Résoudre les mandate_user_id null pour les mandats dont on est le destinataire
    $needsWrite = false;
    foreach ($mandats as &$m) {
        if (
            ($m['mandate_user_id'] ?? null) === null
            && strtolower($m['mandate_user_mail'] ?? '') === $userMailLower
        ) {
            $m['mandate_user_id'] = $userId;
            $m['last_modification_date'] = date('c');
            $needsWrite = true;
        }
    }
    unset($m);
    if ($needsWrite) {
        writeMandats($mandatsFile, $mandats);
    }

    $myMandats = array_values(array_filter($mandats, function ($m) use ($userId, $userMailLower) {
        return ($m['owner_user_id'] ?? '') === $userId
            || ($m['mandate_user_id'] ?? '') === $userId
            || strtolower($m['mandate_user_mail'] ?? '') === $userMailLower;
    }));

    http_response_code(200);
    echo json_encode($myMandats, JSON_UNESCAPED_UNICODE);
    exit();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST – Créer une demande de mandat vers un mail cible
// ─────────────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!isset($body['mandate_user_mail']) || empty(trim($body['mandate_user_mail']))) {
        http_response_code(400);
        echo json_encode(['error' => 'Le champ mandate_user_mail est requis.']);
        exit();
    }

    $targetMail = strtolower(trim($body['mandate_user_mail']));

    // Empêcher un user de se mandater lui-même
    if (!empty($userMail) && strtolower($userMail) === $targetMail) {
        http_response_code(400);
        echo json_encode(['error' => 'Vous ne pouvez pas créer un mandat vers votre propre compte.']);
        exit();
    }

    // Chercher l'id_user de la cible dans le cache de tokens
    $targetUserId = findUserIdByMail($targetMail, $GLOBALS['tokenCache']);

    // NB : Si la cible ne s'est jamais connectée sur ce serveur, son id n'est pas dans le cache.
    // On stocke quand même la demande avec un id null – il sera résolu à la prochaine connexion.
    // (La vérification de mail sera ajoutée ultérieurement via l'API userkey.)

    $mandats = readMandats($mandatsFile);

    // Vérifier qu'un mandat actif ou en attente n'existe pas déjà dans ce sens
    foreach ($mandats as $m) {
        if (
            ($m['owner_user_id'] === $userId || strtolower($m['owner_user_mail'] ?? '') === strtolower($userMail))
            && strtolower($m['mandate_user_mail'] ?? '') === $targetMail
            && in_array($m['statut'] ?? '', ['pending', 'accepted'])
        ) {
            http_response_code(409);
            echo json_encode(['error' => 'Un mandat existe déjà pour ce compte.']);
            exit();
        }
    }

    $exploitationName = getExploitationName($userId, $baseDir);

    $newMandat = [
        'mandat_id'           => generateUUID(),
        'mandat_name'         => $exploitationName ?: ('Exploitation de ' . ($userMail ?: $userId)),
        'creation_date'       => date('c'),
        'last_modification_date' => date('c'),
        'statut'              => 'pending',
        'owner_user_id'       => $userId,
        'owner_user_mail'     => $userMail,
        'mandate_user_id'     => $targetUserId,   // peut être null si inconnu du cache
        'mandate_user_mail'   => $targetMail,
    ];

    $mandats[] = $newMandat;
    writeMandats($mandatsFile, $mandats);

    http_response_code(201);
    echo json_encode(['success' => true, 'mandat' => $newMandat], JSON_UNESCAPED_UNICODE);
    exit();
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT – Mettre à jour le statut d'un mandat (accepter / refuser)
// ─────────────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $mandatId = $_GET['mandat_id'] ?? null;
    if (!$mandatId) {
        http_response_code(400);
        echo json_encode(['error' => 'mandat_id requis.']);
        exit();
    }

    $body = json_decode(file_get_contents('php://input'), true);
    $newStatut = $body['statut'] ?? null;

    if (!in_array($newStatut, ['accepted', 'refused'])) {
        http_response_code(400);
        echo json_encode(['error' => 'statut doit être "accepted" ou "refused".']);
        exit();
    }

    $mandats = readMandats($mandatsFile);
    $found   = false;

    foreach ($mandats as &$m) {
        if (($m['mandat_id'] ?? '') !== $mandatId) continue;

        // Seul le mandaté (user B) peut accepter/refuser
        $isMandatee = ($m['mandate_user_id'] === $userId)
            || (empty($m['mandate_user_id']) && strtolower($m['mandate_user_mail'] ?? '') === strtolower($userMail));

        if (!$isMandatee) {
            http_response_code(403);
            echo json_encode(['error' => 'Seul le mandaté peut accepter ou refuser ce mandat.']);
            exit();
        }

        // Si le mandate_user_id était null (cible inconnue au moment de la création),
        // on le résout maintenant que l'utilisateur est connecté.
        if (empty($m['mandate_user_id'])) {
            $m['mandate_user_id'] = $userId;
        }
        if (empty($m['mandate_user_mail'])) {
            $m['mandate_user_mail'] = $userMail;
        }

        $m['statut']                  = $newStatut;
        $m['last_modification_date']  = date('c');
        $found = true;
        break;
    }
    unset($m);

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'Mandat introuvable.']);
        exit();
    }

    writeMandats($mandatsFile, $mandats);
    http_response_code(200);
    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
    exit();
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE – Supprimer un mandat (owner OU mandaté peuvent supprimer)
// ─────────────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $mandatId = $_GET['mandat_id'] ?? null;
    if (!$mandatId) {
        http_response_code(400);
        echo json_encode(['error' => 'mandat_id requis.']);
        exit();
    }

    $mandats = readMandats($mandatsFile);
    $found   = false;

    $mandats = array_values(array_filter($mandats, function ($m) use ($mandatId, $userId, $userMail, &$found) {
        if (($m['mandat_id'] ?? '') !== $mandatId) return true; // conserver

        $isOwner    = ($m['owner_user_id'] ?? '') === $userId;
        $isMandatee = ($m['mandate_user_id'] ?? '') === $userId
            || strtolower($m['mandate_user_mail'] ?? '') === strtolower($userMail);

        if ($isOwner || $isMandatee) {
            $found = true;
            return false; // supprimer
        }
        return true; // pas le droit → conserver (on gèrera l'erreur après)
    }));

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'Mandat introuvable ou accès refusé.']);
        exit();
    }

    writeMandats($mandatsFile, $mandats);
    http_response_code(200);
    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
    exit();
}

// ─────────────────────────────────────────────────────────────────────────────
// Méthode non supportée
// ─────────────────────────────────────────────────────────────────────────────
http_response_code(405);
echo json_encode(['error' => 'Méthode non supportée.']);
exit();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function generateUUID(): string {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}
