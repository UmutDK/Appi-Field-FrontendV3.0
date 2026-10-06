<?php
// Version robuste avec nom différent pour bypasser le cache
require_once __DIR__ . '/config.php';
require 'vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;

// Configuration pour éviter les conflits de sortie
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Headers CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Workspace-UserId");
    http_response_code(200);
    exit();
}

// Fonction de log sécurisée
function logSafe($message) {
    error_log("[EXPORT-NEW] " . $message);
}

// ============================================================================
// SYSTÈME DE VALIDATION DE TOKEN ROBUSTE (identique à index.php)
// ============================================================================

// Cache global pour les tokens
$GLOBALS['tokenCache'] = isset($GLOBALS['tokenCache']) ? $GLOBALS['tokenCache'] : [];
$cacheTimeout = 1800; // 30 minutes

// Fonction pour récupérer l'id_user depuis le token AVEC CACHE
function getUserIdFromToken($token) {
    global $tokenCache, $cacheTimeout;
    
    logSafe("getUserIdFromToken called with token: " . substr($token, 0, 20) . "...");
    
    if (empty($token)) {
        logSafe("Token vide fourni");
        return null;
    }
    
    // Vérifier le cache d'abord
    $cacheKey = md5($token);
    if (isset($tokenCache[$cacheKey])) {
        $cached = $tokenCache[$cacheKey];
        if (time() - $cached['timestamp'] < $cacheTimeout) {
            logSafe("Token trouvé en cache pour user: " . $cached['user_id']);
            return $cached['user_id'];
        } else {
            // Cache expiré
            unset($tokenCache[$cacheKey]);
            logSafe("Cache expiré pour le token");
        }
    }
    
    // Vérification du token via API
    $url = USERKEY_VERIFY_URL . "?token=" . urlencode($token);
    logSafe("Appel API vérification: " . $url);
    
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
    
    logSafe("API Response - HTTP: $httpCode, Error: $error, Response: " . substr($response, 0, 200));
    
    if ($error || $httpCode !== 200) {
        logSafe("Erreur vérification token - HTTP: $httpCode, Error: $error");
        return null;
    }
    
    // Décoder la réponse JSON
    $userData = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || !isset($userData['Id_User'])) {
        logSafe("Réponse JSON invalide ou Id_User manquant - JSON: " . json_last_error_msg());
        logSafe("Raw response: " . $response);
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
    
    logSafe("Token vérifié avec succès pour utilisateur: " . $userData['Id_User']);
    return $userData['Id_User'];
}

// Fonction pour récupérer le token depuis les headers ou paramètres
function getTokenFromRequest() {
    // 1. Header Authorization
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    
    if (!$authHeader && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? null;
    }
    
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        return substr($authHeader, 7);
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

// ============================================================================
// SYSTÈME DE CACHE ROBUSTE AVEC FALLBACK
// ============================================================================

function getDataCacheFilePath($dataType) {
    return __DIR__ . '/.data_cache_new_' . $dataType . '.json';
}

function loadDataFromCache($dataType, $maxAge = 3600) {
    $cacheFile = getDataCacheFilePath($dataType);
    
    if (file_exists($cacheFile)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if (is_array($cached) && isset($cached['timestamp']) && isset($cached['data'])) {
            if (time() - $cached['timestamp'] < $maxAge) {
                logSafe("Données $dataType chargées depuis le cache (âge: " . (time() - $cached['timestamp']) . "s)");
                return $cached['data'];
            } else {
                logSafe("Cache $dataType expiré (âge: " . (time() - $cached['timestamp']) . "s)");
            }
        }
    }
    
    return null;
}

function saveDataToCache($dataType, $data) {
    $cacheFile = getDataCacheFilePath($dataType);
    $cached = [
        'timestamp' => time(),
        'data' => $data
    ];
    
    if (file_put_contents($cacheFile, json_encode($cached))) {
        logSafe("Données $dataType sauvées en cache");
    } else {
        logSafe("ERREUR: Impossible de sauver le cache $dataType");
    }
}

function fetchDataWithRobustFallback($url, $dataType, $cacheTime = 3600, $forceRefresh = false) {
    // 1. Essayer le cache récent d'abord (sauf si forceRefresh est activé)
    if (!$forceRefresh) {
        $cachedData = loadDataFromCache($dataType, $cacheTime);
        if ($cachedData !== null) {
            return $cachedData;
        }
    } else {
        logSafe("ForceRefresh activé pour $dataType - Ignorer le cache");
    }
    
    // 2. Essayer l'appel HTTP avec retry
    logSafe("Récupération $dataType depuis $url");
    
    $attempts = 0;
    $maxAttempts = 2;
    
    while ($attempts < $maxAttempts) {
        $attempts++;
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Export Tool)');
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($error) {
            logSafe("Tentative $attempts - Erreur cURL pour $dataType: $error");
            if ($attempts < $maxAttempts) {
                sleep(2); // Attendre avant retry
                continue;
            }
        } else if ($httpCode === 200) {
            $data = json_decode($response, true);
            if (is_array($data)) {
                logSafe("Données $dataType récupérées avec succès (tentative $attempts)");
                saveDataToCache($dataType, $data);
                return $data;
            } else {
                logSafe("Tentative $attempts - Données $dataType invalides");
            }
        } else if ($httpCode === 429) {
            logSafe("Tentative $attempts - Rate limit pour $dataType (HTTP 429)");
            if ($attempts < $maxAttempts) {
                sleep(5); // Attendre plus longtemps en cas de rate limit
                continue;
            }
        } else {
            logSafe("Tentative $attempts - Erreur HTTP $httpCode pour $dataType");
        }
        
        // Si on arrive ici, cette tentative a échoué
        if ($attempts < $maxAttempts) {
            sleep(3);
        }
    }
    
    // 3. Essayer le cache étendu (même très ancien)
    logSafe("Échec récupération $dataType - Tentative cache étendu");
    $oldCachedData = loadDataFromCache($dataType, 604800); // 7 jours
    if ($oldCachedData !== null) {
        logSafe("Utilisation cache étendu pour $dataType");
        return $oldCachedData;
    }
    
    // 4. Utiliser des données de fallback minimales
    logSafe("Utilisation données de fallback pour $dataType");
    return getFallbackData($dataType);
}

function getFallbackData($dataType) {
    switch ($dataType) {
        case 'traitements':
            return []; // Aucun traitement = Excel avec message "Aucun traitement trouvé"
            
        case 'users':
            return [[
                'id_user' => '4f790d1b-7494-4c22-bd57-e58c7df65a50',
                'phytolicence' => 'N/A - Données indisponibles',
                'exploiting_number' => 'N/A - Données indisponibles'
            ]];
            
        case 'parcels':
            return []; // Aucune parcelle = colonnes vides mais structure préservée

        case 'crops':
            return [];

        case 'field_works':
            return [];
            
        default:
            return [];
    }
}

// ============================================================================
// SYSTÈME D'AUTHENTIFICATION SIMPLIFIÉ  
// ============================================================================

try {
    logSafe("Export démarré - Version NEW ROBUSTE avec fallback - Timestamp: " . time());
    
    // Validation du token avec le nouveau système
    $token = getTokenFromRequest();
    if (!$token) {
        throw new Exception('Token manquant');
    }
    
    $userId = getUserIdFromToken($token);
    if (!$userId) {
        throw new Exception('Token invalide');
    }
    
    logSafe("Utilisateur authentifié: $userId");
    
    // ============================================================================
    // RÉSOLUTION DU WORKSPACE (mandat)
    // Si le header X-Workspace-UserId est présent et qu'un mandat accepté existe,
    // on filtre les données du compte propriétaire (owner) au lieu du compte connecté.
    // ============================================================================
    $effectiveUserId = $userId;
    $workspaceUserId = $_SERVER['HTTP_X_WORKSPACE_USERID'] ?? null;
    if ($workspaceUserId && $workspaceUserId !== $userId) {
        $mandatsFile = __DIR__ . '/mandats/mandats.json';
        if (file_exists($mandatsFile)) {
            $mandats = json_decode(file_get_contents($mandatsFile), true);
            if (is_array($mandats)) {
                foreach ($mandats as $m) {
                    if (($m['statut'] ?? '') === 'accepted'
                        && ($m['mandate_user_id'] ?? '') === $userId
                        && ($m['owner_user_id'] ?? '') === $workspaceUserId
                    ) {
                        $effectiveUserId = $workspaceUserId;
                        logSafe("Mode workspace actif: export pour le compte $effectiveUserId");
                        break;
                    }
                }
            }
        }
    }
    
    // ============================================================================
    // RÉCUPÉRATION DES FILTRES
    // ============================================================================
    $input = file_get_contents('php://input');
    $requestData = json_decode($input, true);
    $filters = isset($requestData['filters']) ? $requestData['filters'] : [];
    
    $filterYears = isset($filters['years']) && is_array($filters['years']) ? $filters['years'] : [];
    $filterCropNames = isset($filters['cropNames']) && is_array($filters['cropNames']) ? $filters['cropNames'] : [];
    $filterArchiveStatus = isset($filters['archiveStatus']) ? $filters['archiveStatus'] : 'all';
    $filterParcels = isset($filters['parcels']) && is_array($filters['parcels']) ? $filters['parcels'] : [];
    
    logSafe("Filtres reçus - Années: " . implode(',', $filterYears) . 
            ", Cultures: " . implode(',', $filterCropNames) . 
            ", Archive: $filterArchiveStatus" . 
            ", Parcelles: " . implode(',', $filterParcels));
    
    // FORCER LA MISE À JOUR DU CACHE À CHAQUE EXPORT
    logSafe("🔄 Mise à jour forcée du cache pour export frais");
    
    // Récupération des données en local
    function fetchLocalJson($relativePath, $dataType) {
        $fullPath = __DIR__ . '/' . $relativePath;
        if (file_exists($fullPath)) {
            $json = file_get_contents($fullPath);
            $data = json_decode($json, true);
            if (is_array($data)) {
                logSafe("Données $dataType chargées en local: $relativePath");
                return $data;
            } else {
                logSafe("Données $dataType invalides en local: $relativePath");
            }
        } else {
            logSafe("Fichier $dataType introuvable: $relativePath");
        }
        // Fallback si problème
        logSafe("Utilisation fallback pour $dataType");
        return getFallbackData($dataType);
    }

    $traitements = fetchLocalJson('events/phyto_treatments_final.json', 'traitements');
    $users = fetchLocalJson('users_infos.json', 'users');
    $parcels = fetchLocalJson('exploitation/parcels.json', 'parcels');
    $crops = fetchLocalJson('crops/crops.json', 'crops');
    $fieldWorks = fetchLocalJson('events/field_works.json', 'field_works');
    
    // Ces données ne peuvent plus être null grâce aux fallbacks
    logSafe("Données disponibles - Traitements: " . count($traitements) . ", Users: " . count($users) . ", Parcelles: " . count($parcels) . ", Cultures: " . count($crops) . ", Travaux: " . count($fieldWorks));
    
    // Filtrer les données pour l'utilisateur
    $userTraitements = array_filter($traitements, function($t) use ($effectiveUserId) {
        return isset($t['id_user']) && $t['id_user'] === $effectiveUserId;
    });
    
    $userInfo = null;
    foreach ($users as $user) {
        if (isset($user['id_user']) && $user['id_user'] === $effectiveUserId) {
            $userInfo = $user;
            break;
        }
    }
    
    // Si pas d'info utilisateur trouvée, utiliser fallback
    if (!$userInfo) {
        $userInfo = [
            'id_user' => $effectiveUserId,
            'phytolicence' => 'Non disponible',
            'exploiting_number' => 'Non disponible'
        ];
        logSafe("Utilisation info utilisateur de fallback");
    }
    
    logSafe("Génération Excel - Traitements utilisateur: " . count($userTraitements));
    
    // Génération Excel
    $spreadsheet = new Spreadsheet();
    $sheet = $spreadsheet->getActiveSheet();
    $sheet->setTitle('Registre PPP');
    
    // En-têtes
    $headers = [
        'A1' => 'Année',
        'B1' => 'N° Phytolicence du responsable de l\'exploitation',
        'C1' => 'N° d\'exploitant du responsable de l\'exploitation',
        'D1' => 'Date',
        'E1' => 'Nom de la culture ou de l\'espèce emblavée',
        'F1' => 'Culture Phytoweb',
        'G1' => 'Stade phénologique',
        'H1' => 'Date de semis',
        'I1' => 'Remarque (culture)',
        'J1' => 'Culture archivée',
        'K1' => 'Nom de l\'archive',
        'L1' => 'Parcelle',
        'M1' => 'Adresse',
        'N1' => 'Coordonnées',
        'O1' => 'Traitement localisé',
        'P1' => 'Type de traitement',
        'Q1' => 'Produit utilisé (nom commercial)',
        'R1' => 'Produit utilisé (numéro d\'autorisation)',
        'S1' => 'Cible',
        'T1' => 'Surface traitée',
        'U1' => 'Surface traitée (unité)',
        'V1' => 'Quantité totale de traitement',
        'W1' => 'Unité',
        'X1' => 'Quantité de produit',
        'Y1' => 'Unité',
        'Z1' => 'Dose de PPP',
        'AA1' => 'PPP (unité)',
        'AB1' => 'Remarques',
        'AC1' => 'Nettoyage externe de la cuve',
        'AD1' => 'Nom de l\'opérateur(trice)',
        'AE1' => 'Heure de traitement'
    ];
    
    foreach ($headers as $cell => $value) {
        $sheet->setCellValue($cell, $value);
        $sheet->getStyle($cell)->getFont()->setBold(true);
        $sheet->getStyle($cell)->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
    }
    
    // Données
    $row = 2;
    $filteredRowCount = 0;
    
    if (empty($userTraitements)) {
    $sheet->setCellValue('A' . $row, date('Y'));
    $sheet->setCellValue('B' . $row, $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? 'Non disponible');
    $sheet->setCellValue('C' . $row, $userInfo['exploiting_number'] ?? $userInfo['numeroDexploitant'] ?? 'Non disponible');
    $sheet->setCellValue('D' . $row, 'Aucun traitement trouvé pour cet utilisateur');
    $row++;
    } else {
        foreach ($userTraitements as $traitement) {
            $annee = isset($traitement['date']) ? date('Y', strtotime($traitement['date'])) :
                     (isset($traitement['event_date']) ? date('Y', strtotime($traitement['event_date'])) : date('Y'));

            // ============================================================================
            // FILTRE PAR ANNÉE
            // ============================================================================
            if (!empty($filterYears) && !in_array($annee, $filterYears)) {
                continue; // Sauter ce traitement si l'année n'est pas sélectionnée
            }

            $eventType = $traitement['type'] ?? '';
            $composition = $traitement['treatment_composition'] ?? [];
            // backward-compat: unwrap double-wrapped
            if (isset($composition[0]) && is_array($composition[0]) && isset($composition[0][0])) {
                $composition = $composition[0];
            }
            if (is_array($composition)) {
                foreach ($composition as $component) {
                    if (!is_array($component)) continue;
                    // Exclure les produits personnels du Registre PPP
                    $componentId = $component['component_id'] ?? '';
                    if (strpos($componentId, 'perso-') === 0) {
                        continue;
                    }
                    $parcels_concerned = $traitement['parcels_concerned'] ?? [];
                    // backward-compat: unwrap double-wrapped
                    if (isset($parcels_concerned[0]) && is_array($parcels_concerned[0]) && isset($parcels_concerned[0][0])) {
                        $parcels_concerned = $parcels_concerned[0];
                    }
                    if (is_array($parcels_concerned)) {
                        foreach ($parcels_concerned as $parcel) {
                            if (!is_array($parcel)) continue;
                            // ============================================================================
                            // FILTRE PAR NOM DE CULTURE
                            // ============================================================================
                            if (!empty($filterCropNames)) {
                                $cropName = $parcel['crop_name'] ?? '';
                                if (!in_array($cropName, $filterCropNames)) {
                                    continue; // Sauter cette parcelle si la culture n'est pas sélectionnée
                                }
                            }

                            // ============================================================================
                            // FILTRE PAR STATUT D'ARCHIVAGE
                            // ============================================================================
                            $isArchived = ($parcel['is_archived'] ?? $parcel['isArchived'] ?? false) === true;
                            if ($filterArchiveStatus === 'archived' && !$isArchived) {
                                continue; // Sauter si on veut les archivées et que ce n'est pas archivé
                            }
                            if ($filterArchiveStatus === 'not-archived' && $isArchived) {
                                continue; // Sauter si on veut les non-archivées et que c'est archivé
                            }

                            // ============================================================================
                            // FILTRE PAR PARCELLE
                            // ============================================================================
                            if (!empty($filterParcels)) {
                                $parcelName = $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? '';
                                if (!in_array($parcelName, $filterParcels)) {
                                    continue; // Sauter cette parcelle si elle n'est pas sélectionnée
                                }
                            }

                            // Si on arrive ici, la ligne passe tous les filtres
                            $filteredRowCount++;

                            // Trouver les infos de la parcelle
                            $parcelInfo = null;
                            $parcelId = $parcel['parcel_id'] ?? $parcel['parcels_id'] ?? null;
                            if ($parcelId) {
                                foreach ($parcels as $p) {
                                    if ((isset($p['id_parcel']) && $p['id_parcel'] == $parcelId) ||
                                        (isset($p['place_id']) && $p['place_id'] == $parcelId)) {
                                        $parcelInfo = $p;
                                        break;
                                    }
                                }
                            }
                            $coordonnees = '';
                            if ($parcelInfo && isset($parcelInfo['lat']) && isset($parcelInfo['lon'])) {
                                $coordonnees = $parcelInfo['lat'] . '+' . $parcelInfo['lon'];
                            }
                            // Trouver les infos de la culture
                            $cropInfo = null;
                            $cropId = $parcel['crop_id'] ?? null;
                            if ($cropId) {
                                foreach ($crops as $c) {
                                    if (isset($c['crop_id']) && $c['crop_id'] === $cropId && isset($c['id_user']) && $c['id_user'] === $effectiveUserId) {
                                        $cropInfo = $c;
                                        break;
                                    }
                                }
                            }
                            $sowingDate = ($cropInfo && !empty($cropInfo['sowing_date'])) ? $cropInfo['sowing_date'] : 'Non précisé';
                            $cropRemark = $cropInfo['remark'] ?? '';
                            // Quantité totale de traitement
                            $qt_total_traitement = str_replace(',', '.', $parcel['treatment_volume_applied'] ?? '');
                            // Unité (après Quantité totale de traitement)
                            $qt_total_unite = $parcel['treatment_volume_applied_unit'] ?? 'L';
                            // Calcul quantité de produit
                            $qt_produit = '';
                            $std_dose = str_replace(',', '.', $component['standard_component_dose'] ?? null);
                            $std_surface = str_replace(',', '.', $parcel['standard_surface_treated'] ?? null);
                            if ($eventType === 'phyto_porridge_treatment' && is_numeric($qt_total_traitement) && is_numeric($std_dose)) {
                                $qt_produit = floatval($qt_total_traitement) * (floatval($std_dose) / 100);
                            } elseif (($eventType === 'phyto_surface_treatment' || $eventType === 'phyto_quantity_treatment') && is_numeric($std_dose) && is_numeric($std_surface)) {
                                $qt_produit = floatval($std_dose) * floatval($std_surface);
                            } else {
                                $qt_produit = $qt_total_traitement;
                            }
                            // Unité (après Quantité de produit)
                            $qt_produit_unite = $component['component_quantity_unity'] ?? 'L';
                            // ...
                            $sheet->setCellValue('A' . $row, $annee);
                            $sheet->setCellValue('B' . $row, $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? '');
                            $sheet->setCellValue('C' . $row, $userInfo['exploiting_number'] ?? $userInfo['numeroDexploitant'] ?? '');
                            $sheet->setCellValue('D' . $row, $traitement['date'] ?? $traitement['event_date'] ?? '');
                            $sheet->setCellValue('E' . $row, $parcel['crop_name'] ?? '');
                            $sheet->setCellValue('F' . $row, $parcel['phytoweb_name'] ?? $parcel['nomPhytoweb_crops_id'] ?? '');
                            $sheet->setCellValue('G' . $row, $traitement['bbch'] ?? '');
                            // Nouvelles colonnes culture
                            $sheet->setCellValue('H' . $row, $sowingDate);
                            $sheet->setCellValue('I' . $row, $cropRemark);
                            // Colonnes d'archivage (utilise $isArchived déjà défini plus haut pour le filtrage)
                            $sheet->setCellValue('J' . $row, $isArchived ? 'Vrai' : 'Faux');
                            $sheet->setCellValue('K' . $row, $isArchived ? ($parcel['collection'] ?? '') : '');
                            // Colonnes décalées
                            $sheet->setCellValue('L' . $row, $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? '');
                            $sheet->setCellValue('M' . $row, $parcelInfo['parcel_address'] ?? '');
                            $sheet->setCellValue('N' . $row, $coordonnees);
                            $sheet->setCellValue('O' . $row, $traitement['localized_treatment'] ?? $traitement['traitementLocal'] ?? '');
                            $sheet->setCellValue('P' . $row, 'Traitement de surface');
                            $sheet->setCellValue('Q' . $row, $component['component_name'] ?? '');
                            $sheet->setCellValue('R' . $row, $component['component_numaut'] ?? '');
                            $sheet->setCellValue('S' . $row, $traitement['target'] ?? ($traitement['treatment_composition'][0]['target'] ?? $traitement['ciblee'] ?? ''));
                            $sheet->setCellValue('T' . $row, $parcel['parcel_surface_treated'] ?? '');
                            $sheet->setCellValue('U' . $row, $parcel['surface_unit'] ?? '');
                            $sheet->setCellValue('V' . $row, $qt_total_traitement);
                            $sheet->setCellValue('W' . $row, $qt_total_unite);
                            $sheet->setCellValue('X' . $row, $qt_produit);
                            $sheet->setCellValue('Y' . $row, $qt_produit_unite);
                            $sheet->setCellValue('Z' . $row, $component['component_dose'] ?? '');
                            $sheet->setCellValue('AA' . $row, $component['component_dose_unit'] ?? '');
                            $sheet->setCellValue('AB' . $row, $traitement['remark'] ?? $traitement['remarque'] ?? $traitement['autres_remarques'] ?? '');
                            $sheet->setCellValue('AC' . $row, $traitement['clean_flag'] ?? $traitement['effectuerNottoyage'] ?? '');
                            $sheet->setCellValue('AD' . $row, ($traitement['operator_name'] ?? '') . (($traitement['operator_phytolicence'] ?? $traitement['operator_pl'] ?? '') ? ' (' . ($traitement['operator_phytolicence'] ?? $traitement['operator_pl']) . ')' : ''));
                            $sheet->setCellValue('AE' . $row, $traitement['event_hour'] ?? '');
                            $row++;
                        }
                    }
                }
            }
        }
    }
    
    // Si des filtres sont appliqués mais aucun résultat ne correspond
    if (!empty($userTraitements) && $filteredRowCount === 0) {
        $sheet->setCellValue('A' . $row, date('Y'));
        $sheet->setCellValue('B' . $row, $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? 'Non disponible');
        $sheet->setCellValue('C' . $row, $userInfo['exploiting_number'] ?? $userInfo['numeroDexploitant'] ?? 'Non disponible');
        $sheet->setCellValue('D' . $row, 'Aucun traitement ne correspond aux filtres sélectionnés');
        $row++;
        logSafe("Aucun résultat après application des filtres");
    }
    
    // Auto-dimensionner les colonnes
    foreach (range('A', 'Z') as $column) {
        $sheet->getColumnDimension($column)->setAutoSize(true);
    }
    // Ajouter AA, AB et AC pour les nouvelles colonnes
    $sheet->getColumnDimension('AA')->setAutoSize(true);
    $sheet->getColumnDimension('AB')->setAutoSize(true);
    $sheet->getColumnDimension('AC')->setAutoSize(true);
    $sheet->getColumnDimension('AD')->setAutoSize(true);
    $sheet->getColumnDimension('AE')->setAutoSize(true);
    
    // Bordures
    $styleArray = [
        'borders' => [
            'allBorders' => [
                'borderStyle' => Border::BORDER_THIN,
            ],
        ],
    ];
    $sheet->getStyle('A1:AE' . ($row - 1))->applyFromArray($styleArray);
    
    logSafe("Excel créé avec succès - Version NEW ROBUSTE ($row lignes, $filteredRowCount lignes filtrées)");
    
    // ============================================================================
    // FEUILLE 2 : CARNET DE CHAMP (toutes interventions)
    // ============================================================================
    $sheetCDC = $spreadsheet->createSheet();
    $sheetCDC->setTitle('Carnet de champ');
    
    $headersCDC = [
        'A1' => 'Année',
        'B1' => 'Type',
        'C1' => 'N° Phytolicence du responsable de l\'exploitation',
        'D1' => 'N° d\'exploitant du responsable de l\'exploitation',
        'E1' => 'Date',
        'F1' => 'Nom de la culture ou de l\'espèce emblavée',
        'G1' => 'Culture Phytoweb',
        'H1' => 'Date de semis',
        'I1' => 'Remarque (culture)',
        'J1' => 'Culture archivée',
        'K1' => 'Nom de l\'archive',
        'L1' => 'Parcelle',
        'M1' => 'Informations',
        'N1' => 'Outil',
        'O1' => 'Cible',
        'P1' => 'Remarques',
    ];
    foreach ($headersCDC as $cell => $value) {
        $sheetCDC->setCellValue($cell, $value);
        $sheetCDC->getStyle($cell)->getFont()->setBold(true);
        $sheetCDC->getStyle($cell)->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
    }
    
    $rowCDC = 2;
    
    // --- Traitements Phyto ---
    foreach ($userTraitements as $traitement) {
        $anneeCDC = isset($traitement['date']) ? date('Y', strtotime($traitement['date'])) :
                    (isset($traitement['event_date']) ? date('Y', strtotime($traitement['event_date'])) : date('Y'));
        $eventTypeCDC = $traitement['type'] ?? '';
        $compositionCDC = $traitement['treatment_composition'] ?? [];
        if (isset($compositionCDC[0]) && is_array($compositionCDC[0]) && isset($compositionCDC[0][0])) {
            $compositionCDC = $compositionCDC[0];
        }
        if (is_array($compositionCDC)) {
            foreach ($compositionCDC as $componentCDC) {
                if (!is_array($componentCDC)) continue;
                $parcelsConcernedCDC = $traitement['parcels_concerned'] ?? [];
                if (isset($parcelsConcernedCDC[0]) && is_array($parcelsConcernedCDC[0]) && isset($parcelsConcernedCDC[0][0])) {
                    $parcelsConcernedCDC = $parcelsConcernedCDC[0];
                }
                if (is_array($parcelsConcernedCDC)) {
                    foreach ($parcelsConcernedCDC as $parcelCDC) {
                        if (!is_array($parcelCDC)) continue;
                        $cropInfoCDC = null;
                        $cropIdCDC = $parcelCDC['crop_id'] ?? null;
                        if ($cropIdCDC) {
                            foreach ($crops as $c) {
                                if (isset($c['crop_id']) && $c['crop_id'] === $cropIdCDC && isset($c['id_user']) && $c['id_user'] === $effectiveUserId) {
                                    $cropInfoCDC = $c;
                                    break;
                                }
                            }
                        }
                        $sowingDateCDC = ($cropInfoCDC && !empty($cropInfoCDC['sowing_date'])) ? $cropInfoCDC['sowing_date'] : 'Non précisé';
                        $cropRemarkCDC = $cropInfoCDC['remark'] ?? '';
                        $isArchivedCDC = ($parcelCDC['is_archived'] ?? $parcelCDC['isArchived'] ?? false) === true;

                        $qtTotalCDC = str_replace(',', '.', $parcelCDC['treatment_volume_applied'] ?? '');
                        $stdDoseCDC = str_replace(',', '.', $componentCDC['standard_component_dose'] ?? null);
                        $stdSurfaceCDC = str_replace(',', '.', $parcelCDC['standard_surface_treated'] ?? null);
                        if ($eventTypeCDC === 'phyto_porridge_treatment' && is_numeric($qtTotalCDC) && is_numeric($stdDoseCDC)) {
                            $qtProduitCDC = floatval($qtTotalCDC) * (floatval($stdDoseCDC) / 100);
                        } elseif (($eventTypeCDC === 'phyto_surface_treatment' || $eventTypeCDC === 'phyto_quantity_treatment') && is_numeric($stdDoseCDC) && is_numeric($stdSurfaceCDC)) {
                            $qtProduitCDC = floatval($stdDoseCDC) * floatval($stdSurfaceCDC);
                        } else {
                            $qtProduitCDC = $qtTotalCDC;
                        }
                        $qtProduitUniteCDC = $componentCDC['component_quantity_unity'] ?? 'L';

                        $compName = $componentCDC['component_name'] ?? '';
                        $compNumaut = $componentCDC['component_numaut'] ?? '';
                        $compDose = $componentCDC['component_dose'] ?? '';
                        $compDoseUnit = $componentCDC['component_dose_unit'] ?? '';
                        $infoStrCDC = $compName . ' (' . $compNumaut . ') - ' . $compDose . ' ' . $compDoseUnit . ' (' . $qtProduitCDC . ' ' . $qtProduitUniteCDC . ')';

                        $sheetCDC->setCellValue('A' . $rowCDC, $anneeCDC);
                        $sheetCDC->setCellValue('B' . $rowCDC, 'Traitement Phyto');
                        $sheetCDC->setCellValue('C' . $rowCDC, $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? '');
                        $sheetCDC->setCellValue('D' . $rowCDC, $userInfo['exploiting_number'] ?? $userInfo['numeroDexploitant'] ?? '');
                        $sheetCDC->setCellValue('E' . $rowCDC, $traitement['date'] ?? $traitement['event_date'] ?? '');
                        $sheetCDC->setCellValue('F' . $rowCDC, $parcelCDC['crop_name'] ?? '');
                        $sheetCDC->setCellValue('G' . $rowCDC, $parcelCDC['phytoweb_name'] ?? $parcelCDC['nomPhytoweb_crops_id'] ?? '');
                        $sheetCDC->setCellValue('H' . $rowCDC, $sowingDateCDC);
                        $sheetCDC->setCellValue('I' . $rowCDC, $cropRemarkCDC);
                        $sheetCDC->setCellValue('J' . $rowCDC, $isArchivedCDC ? 'Vrai' : 'Faux');
                        $sheetCDC->setCellValue('K' . $rowCDC, $isArchivedCDC ? ($parcelCDC['collection'] ?? '') : '');
                        $sheetCDC->setCellValue('L' . $rowCDC, $parcelCDC['parcel_name'] ?? $parcelCDC['parcels_name'] ?? '');
                        $sheetCDC->setCellValue('M' . $rowCDC, $infoStrCDC);
                        $sheetCDC->setCellValue('N' . $rowCDC, '');
                        $sheetCDC->setCellValue('O' . $rowCDC, $traitement['target'] ?? ($traitement['treatment_composition'][0]['target'] ?? $traitement['ciblee'] ?? ''));
                        $sheetCDC->setCellValue('P' . $rowCDC, $traitement['remark'] ?? $traitement['remarque'] ?? $traitement['autres_remarques'] ?? '');
                        $rowCDC++;
                    }
                }
            }
        }
    }
    
    // --- Travaux aux champs ---
    $userFieldWorks = array_filter($fieldWorks, function($fw) use ($effectiveUserId) {
        return isset($fw['id_user']) && $fw['id_user'] === $effectiveUserId;
    });
    
    foreach ($userFieldWorks as $fw) {
        $typeWork = $fw['type'] ?? $fw['type_travaux_aux_champs'] ?? '';
        $anneeFW = isset($fw['date']) ? date('Y', strtotime($fw['date'])) : (isset($fw['datee']) ? date('Y', strtotime($fw['datee'])) : date('Y'));
        $parcelsFW = isset($fw['parcels_concerned']) && is_array($fw['parcels_concerned']) ? $fw['parcels_concerned'] : [];
        
        foreach ($parcelsFW as $parcelFW) {
            $cropInfoFW = null;
            $cropIdFW = $parcelFW['crop_id'] ?? null;
            if ($cropIdFW) {
                foreach ($crops as $c) {
                    if (isset($c['crop_id']) && $c['crop_id'] === $cropIdFW && isset($c['id_user']) && $c['id_user'] === $effectiveUserId) {
                        $cropInfoFW = $c;
                        break;
                    }
                }
            }
            $sowingDateFW = ($cropInfoFW && !empty($cropInfoFW['sowing_date'])) ? $cropInfoFW['sowing_date'] : 'Non précisé';
            $cropRemarkFW = $cropInfoFW['remark'] ?? '';
            $isArchivedFW = ($parcelFW['is_archived'] ?? $parcelFW['isArchived'] ?? false) === true;
            
            $infoStrFW = '';
            $outilStrFW = '';
            switch ($typeWork) {
                case 'Travail du sol':
                    $infoStrFW = ($fw['field_work_type'] ?? $fw['travailtype'] ?? '') . '/' . ($fw['description'] ?? '');
                    break;
                case 'Fertilisation':
                    $infoStrFW = $fw['informations'] ?? '';
                    $outilStrFW = $fw['tool'] ?? $fw['outil'] ?? '';
                    break;
                case 'Observation':
                    $infoStrFW = $fw['observation'] ?? '';
                    break;
                case 'Irrigation':
                    $dose = $fw['dose'] ?? '';
                    $lha = $fw['dose_unit'] ?? $fw['lha'] ?? '';
                    $infoStrFW = trim($dose . ' ' . $lha);
                    break;
                case 'Récolte':
                    $infoStrFW = $fw['harvest_date'] ?? $fw['dateDeRecolte'] ?? '';
                    break;
                default:
                    $infoStrFW = $fw['informations'] ?? '';
                    break;
            }
            
            $sheetCDC->setCellValue('A' . $rowCDC, $anneeFW);
            $sheetCDC->setCellValue('B' . $rowCDC, $typeWork);
            $sheetCDC->setCellValue('C' . $rowCDC, $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? '');
            $sheetCDC->setCellValue('D' . $rowCDC, $userInfo['exploiting_number'] ?? $userInfo['numeroDexploitant'] ?? '');
            $sheetCDC->setCellValue('E' . $rowCDC, $fw['date'] ?? $fw['datee'] ?? '');
            $sheetCDC->setCellValue('F' . $rowCDC, $parcelFW['crop_name'] ?? '');
            $sheetCDC->setCellValue('G' . $rowCDC, $parcelFW['phytoweb_name'] ?? $parcelFW['nomPhytoweb_crops_id'] ?? '');
            $sheetCDC->setCellValue('H' . $rowCDC, $sowingDateFW);
            $sheetCDC->setCellValue('I' . $rowCDC, $cropRemarkFW);
            $sheetCDC->setCellValue('J' . $rowCDC, $isArchivedFW ? 'Vrai' : 'Faux');
            $sheetCDC->setCellValue('K' . $rowCDC, $isArchivedFW ? ($parcelFW['collection'] ?? '') : '');
            $sheetCDC->setCellValue('L' . $rowCDC, $parcelFW['parcel_name'] ?? $parcelFW['parcels_name'] ?? '');
            $sheetCDC->setCellValue('M' . $rowCDC, $infoStrFW);
            $sheetCDC->setCellValue('N' . $rowCDC, $outilStrFW);
            $sheetCDC->setCellValue('O' . $rowCDC, '');
            $sheetCDC->setCellValue('P' . $rowCDC, $fw['remark'] ?? $fw['remaques'] ?? '');
            $rowCDC++;
        }
    }
    
    // Auto-dimensionner les colonnes de la feuille Carnet de champ
    foreach (range('A', 'P') as $col) {
        $sheetCDC->getColumnDimension($col)->setAutoSize(true);
    }
    // Bordures feuille Carnet de champ
    $lastRowCDC = $rowCDC > 2 ? $rowCDC - 1 : 1;
    $sheetCDC->getStyle('A1:P' . $lastRowCDC)->applyFromArray($styleArray);
    
    logSafe("Feuille Carnet de champ créée ($rowCDC lignes)");
    
    // Nettoyage de la sortie avant d'envoyer le fichier
    if (ob_get_level()) {
        ob_clean();
    }
    
    // Headers pour le téléchargement
    // Nom du fichier avec indication si des filtres sont appliqués
    $hasFilters = !empty($filterYears) || !empty($filterCropNames) || $filterArchiveStatus !== 'all' || !empty($filterParcels);
    $filename = 'Registre_' . ($hasFilters ? 'filtre_' : '') . date('Y-m-d') . '.xlsx';
    
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment;filename="' . $filename . '"');
    header('Cache-Control: max-age=0');
    header('Pragma: public');
    header('Expires: 0');
    
    // Génération et envoi du fichier
    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    
    logSafe("Fichier envoyé: $filename");

} catch (Exception $e) {
    logSafe("ERREUR: " . $e->getMessage());
    
    // Nettoyage de la sortie
    if (ob_get_level()) {
        ob_clean();
    }
    
    // Retourner l'erreur en JSON
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'NEW VERSION - Erreur lors de la génération du fichier Excel: ' . $e->getMessage()]);
}
?>
