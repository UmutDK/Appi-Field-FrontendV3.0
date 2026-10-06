<?php
// import des modules de fonctions utilitaires
require_once 'auth_utils.php';
require_once 'user_utils.php';
require_once 'inventory_utils.php';
require_once 'crop_utils.php';
require_once 'treatment_utils.php';
require_once 'file_utils.php';
require_once 'response_utils.php';
require_once 'validation_utils.php';
require_once 'phyto_treatment_handler.php';
require_once 'archive_utils.php';
require_once 'personal_product_handler.php';
// Configuration d'erreur pour debug
ini_set('display_errors', 0); // Désactiver l'affichage des erreurs pour éviter de corrompre le JSON
ini_set('log_errors', 1);
error_reporting(E_ALL);

// En-têtes CORS - DOIT être en premier
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, PUT, DELETE, GET, UPDATE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, X-Workspace-UserId");
header("Access-Control-Max-Age: 3600"); // Cache preflight pour 1 heure
header("Cache-Control: no-cache");

// Gère la requête preflight CORS AVANT tout autre traitement
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ============================================================================
// SYSTÈME DE CACHE POUR LES TOKENS (RÉSOUT LE RATE LIMITING HTTP 429)
// ============================================================================

// Cache des tokens vérifiés (30 minutes)
$GLOBALS['tokenCache'] ??= [];
$GLOBALS['cacheTimeout'] = 1800;

// Dossier de base
$baseDir = __DIR__ . '/';

// Charger le cache au démarrage
loadTokenCacheFromDisk();

// Récupère le chemin du fichier demandé
$file = isset($_GET['file']) ? $_GET['file'] : 'users.json';

// Détecte l'extension pour le Content-Type
$isGeojson = (isset($_GET['file']) && preg_match('/\.geojson$/', $_GET['file']));
header("Content-Type: " . ($isGeojson ? "application/geo+json" : "application/json") . "; charset=UTF-8");

// Fonction pour mettre à jour l'inventaire directement (sans API) après modification de traitements
// Fonction utilitaire pour convertir un traitement en données d'événement d'inventaire avec unités
// ============================================================================
// TRAITEMENT DES REQUÊTES HTTP
// ============================================================================

// ====================================================================
// ROUTE SPÉCIALE : Produits personnalisés (index/personnal_product.json)
// ====================================================================
if ($file === 'index/personnal_product.json') {
    $userId = authenticateAndGetUserId();
    if (!$userId) {
        http_response_code(401);
        echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
        exit;
    }
    $requestData = null;
    if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'DELETE') {
        $body = file_get_contents('php://input');
        $requestData = json_decode($body, true);
    }
    handlePersonalProducts($_SERVER['REQUEST_METHOD'], $baseDir, $userId, $requestData);
    exit;
}

// Sécurité : accepte .json et .geojson, pas de ../ ni de caractères spéciaux
if (
    preg_match('/^[\w\-\/]+\.(json|geojson)$/', $file) &&
    strpos($file, '..') === false
) {
    $fullPath = realpath($baseDir . $file) ?: $baseDir . $file;
    if (strpos(realpath(dirname($fullPath)), realpath($baseDir)) === 0) {
        $method = $_SERVER['REQUEST_METHOD'];
        
        // ====================================================================
        // MÉTHODE GET - LECTURE DE DONNÉES
        // ====================================================================
        if ($method === 'GET') {
            
            // Toujours servir les fichiers locaux : pas d'appel HTTP vers le même endpoint
            // (Les fonctions qui faisaient des appels distants ont été adaptées pour utiliser les fichiers locaux.)
            
            // ====================================================================
            // ACTIONS SPÉCIALES POUR LES ARCHIVES DE CULTURES
            // ====================================================================
            handleArchiveRoutes($method, $fullPath, $baseDir);
            // ====================================================================
                        
            // GET individuel par id_parcel
            if (isset($_GET['id_parcel'])) {
                $id_parcel = $_GET['id_parcel'];
                $data = readJsonFile($fullPath);
                if ($data !== null && is_array($data)) {
                    foreach ($data as $entry) {
                        if (isset($entry['id_parcel']) && $entry['id_parcel'] === $id_parcel) {
                            sendJsonResponse($entry, 200);
                        }
                    }
                    sendNotFoundResponse("id_parcel $id_parcel non trouvé.");
                }
                sendNotFoundResponse('Fichier non trouvé ou JSON invalide.');
            }
            
            // GET individuel par id_user
            if (isset($_GET['id_user'])) {
                $id_user = $_GET['id_user'];
                $data = readJsonFile($fullPath);
                if ($data !== null && is_array($data)) {
                    applyGetMigrations($file, $fullPath, $data);
                    foreach ($data as $entry) {
                        if (isset($entry['id_user']) && $entry['id_user'] === $id_user) {
                            sendJsonResponse($entry, 200);
                        }
                    }
                    sendNotFoundResponse("id_user $id_user non trouvé.");
                }
                sendNotFoundResponse('Fichier non trouvé ou JSON invalide.');
            }
            
            handlePhytoTreatmentRoutes($method, $file, $fullPath, $baseDir);
            
            // GET standard : retourner tout le fichier
            if (is_file($fullPath)) {
                
                // ===== TRAITEMENT SPÉCIAL POUR LE DOSSIER INDEX/ (DOCUMENTS PUBLICS) =====
                // Utilisation de la logique simple et rapide pour éviter les timeouts
                if (strpos($file, 'index/') === 0) {
                    $content = file_get_contents($fullPath);
                    if (trim($content) === '') {
                        sendNotFoundResponse('Fichier vide.');
                    } else {
                        // Traitement simple : retourner le contenu directement
                        echo $content;
                    }
                    exit;
                }
                // ===== FIN TRAITEMENT SPÉCIAL INDEX/ =====
                
                $fileSize = filesize($fullPath);
                
                // Vérification préventive de la taille - suggestion de pagination pour très gros fichiers
                if ($fileSize > 100 * 1024 * 1024) { // Si > 100MB
                    $isIndexFolder = (strpos($file, 'index/') === 0);
                    $paginationRequested = isset($_GET['paginated']) && $_GET['paginated'] === 'true';
                    
                    if (!$paginationRequested) {
                        // Avertissement dans les logs mais on continue le traitement
                    }
                }
                
                $content = file_get_contents($fullPath);
                if (trim($content) === '') {
                    sendNotFoundResponse('Fichier vide.');
                } else {
                    $data = json_decode($content, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($data)) {
                        applyGetMigrations($file, $fullPath, $data);

                        if (strpos($file, 'index/') === 0) {
                            sendPaginatedOrFull($data);
                        } else {
                            try {
                                $userId = resolveWorkspaceUserId($baseDir);
                                if ($userId) {
                                    $filteredData = filterDataByUserId($data, $userId);
                                    if (!is_array($filteredData)) {
                                        $filteredData = [];
                                    }
                                    sendPaginatedOrFull($filteredData);
                                } else {
                                    echo json_encode([], JSON_UNESCAPED_UNICODE);
                                }
                            } catch (Exception $e) {
                                echo json_encode([], JSON_UNESCAPED_UNICODE);
                            }
                        }
                    } else {
                        // JSON invalide ou non-array - retourner un tableau vide
                        echo json_encode([], JSON_UNESCAPED_UNICODE);
                    }
                }
                exit;
            }
            
        // ====================================================================
        // MÉTHODE POST - CRÉATION/AJOUT DE DONNÉES
        // ====================================================================
        } elseif ($method === 'POST') {
            
            //  AUTHENTIFICATION pour les fichiers non-publics (SAUF index/, users_infos.json, exploitation/exploitations.json)
            $userId = null;
            if (strpos($file, 'index/') !== 0 && $file !== 'users_infos.json' && $file !== 'exploitation/exploitations.json') {
                $userId = authenticateAndGetUserId();
                if (!$userId) {
                    http_response_code(401);
                    echo json_encode(['error' => 'Unauthorized']);
                    exit;
                }
            }
            // Résoudre l'id_user effectif : workspace owner si on est dans l'espace d'un autre compte, sinon user connecté
            $effectiveUserId = $userId ? resolveWorkspaceUserId($baseDir) : null;
            
            // DISPATCH DES ROUTES SPÉCIALES POST (archives + traitements phyto)
            handleArchiveRoutes($method, $fullPath, $baseDir, $userId, $effectiveUserId);
            handlePhytoTreatmentRoutes($method, $file, $fullPath, $baseDir, $userId, $effectiveUserId);
            
            // Traitement des routes publiques (index/, users_infos.json, exploitation/exploitations.json)
            handlePublicPostRoutes($file, $fullPath, $baseDir);
            
            $input   = file_get_contents('php://input');
            $newData = json_decode($input, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                http_response_code(400);
                echo json_encode(['error' => 'Le contenu envoyé n\'est pas un JSON valide.']);
                exit;
            }

            // Calcul immédiat de component_quantity_unity si component_dose_unit est présent
            if (strpos($file, 'phyto_treatments') !== false) {
                if (isset($newData['component_dose_unit']) && !isset($newData['component_quantity_unity'])) {
                    $newData['component_quantity_unity'] = getQuantityUnitFromDoseUnit($newData['component_dose_unit']);
                }
            }

            // Inventaires : route spéciale (gestion des événements)
            if (strpos($file, 'inventories.json') !== false) {
                handleInventoryPostRoutes($file, $fullPath, $userId, $effectiveUserId, $newData);
            }

            // Normaliser les travaux au champ vers la nouvelle structure de champs
            if (strpos($file, 'field_works.json') !== false) {
                if (is_array($newData) && array_values($newData) === $newData) {
                    foreach ($newData as &$fwEntry) { normalizeFieldWorkStructure($fwEntry); }
                    unset($fwEntry);
                } else {
                    normalizeFieldWorkStructure($newData);
                }
            }

            // Merge standard et écriture
            $isPhytoFinalFile = (strpos($file, 'phyto_treatments_final.json') !== false);
            $result = mergeJsonFile($fullPath, $file, $newData, $effectiveUserId);

            // Mise à jour automatique de l'inventaire après sauvegarde d'un traitement phyto
            if ($isPhytoFinalFile && is_array($result)) {
                $affectedIds = [];
                if (isset($newData['event_id'])) {
                    $affectedIds[] = $newData['event_id'];
                } elseif (is_array($newData) && array_values($newData) === $newData) {
                    foreach ($newData as $t) {
                        if (is_array($t) && isset($t['event_id'])) $affectedIds[] = $t['event_id'];
                    }
                }
                if (!empty($affectedIds)) {
                    $freshData = $result;
                    if (file_exists($fullPath)) {
                        $fc = file_get_contents($fullPath);
                        if ($fc !== false) {
                            $fd = json_decode($fc, true);
                            if (is_array($fd)) $freshData = $fd;
                        }
                    }
                    updateInventoryForModifiedTreatmentsDirect($freshData, $affectedIds, $effectiveUserId, $baseDir);
                }
            }

            // Réponse enrichie pour les traitements phyto (retourne le traitement créé/modifié)
            if ($isPhytoFinalFile && is_array($result) && isset($newData['event_id'])) {
                $eventId = $newData['event_id'];
                $createdTreatment = null;
                foreach ($result as $treatment) {
                    if (isset($treatment['event_id']) && $treatment['event_id'] === $eventId) {
                        $createdTreatment = $treatment;
                        break;
                    }
                }
                if ($createdTreatment) {
                    echo json_encode(['success' => true, 'message' => 'Traitement créé avec succès', 'event_id' => $eventId, 'treatment' => $createdTreatment]);
                    exit;
                }
            }
            echo json_encode(['success' => true, 'result' => $result]);
            exit;
            
        // ====================================================================
        // MÉTHODE DELETE - SUPPRESSION DE DONNÉES
        // ====================================================================
        } elseif ($method === 'DELETE') {
            
            // ===== TRAITEMENT SPÉCIAL POUR LE DOSSIER INDEX/ (DOCUMENTS PUBLICS) =====
            // Utilisation de la logique simple sans authentification pour les documents publics
            if (strpos($file, 'index/') === 0) {
                // Suppression d'une entrée par id ou idGestionDesOperations
                parse_str(file_get_contents("php://input"), $deleteParams);
                $id = null;
                if (isset($_GET['id'])) {
                    $id = $_GET['id'];
                } elseif (isset($_GET['idGestionDesOperations'])) {
                    $id = $_GET['idGestionDesOperations'];
                } elseif (isset($deleteParams['id'])) {
                    $id = $deleteParams['id'];
                } elseif (isset($deleteParams['idGestionDesOperations'])) {
                    $id = $deleteParams['idGestionDesOperations'];
                }

                if ($id === null) {
                    http_response_code(400);
                    echo json_encode(['error' => 'Paramètre id manquant pour la suppression.']);
                    exit;
                }

                if (is_file($fullPath)) {
                    $content = file_get_contents($fullPath);
                    $data = json_decode($content, true);

                    if (json_last_error() === JSON_ERROR_NONE && is_array($data)) {
                        $found = false;
                        $newData = [];
                        foreach ($data as $entry) {
                            // On supprime si id ou idGestionDesOperations correspond à la valeur reçue
                            if (
                                (is_array($entry) && isset($entry['id']) && $entry['id'] == $id) ||
                                (is_array($entry) && isset($entry['idGestionDesOperations']) && $entry['idGestionDesOperations'] == $id)
                            ) {
                                $found = true;
                                continue;
                            }
                            $newData[] = $entry;
                        }
                        if ($found) {
                            atomicWriteJsonFile($fullPath, $newData);
                            echo json_encode(['success' => true, 'deleted_id' => $id]);
                        } else {
                            http_response_code(404);
                            echo json_encode([
                                'error' => "Entrée avec id ou idGestionDesOperations $id non trouvée.",
                                'debug' => 'Vérifiez la structure de vos objets dans le fichier.'
                            ]);
                        }
                        exit;
                    } else {
                        http_response_code(400);
                        echo json_encode(['error' => 'Le fichier n\'est pas un tableau JSON valide.']);
                        exit;
                    }
                } else {
                    http_response_code(404);
                    echo json_encode(['error' => 'Fichier non trouvé.']);
                    exit;
                }
            }
            // ===== FIN TRAITEMENT SPÉCIAL INDEX/ =====
            
            // Authentifier l'utilisateur pour tous les DELETE (sauf index/)
            $userId = authenticateAndGetUserId();
            if (!$userId) {
                http_response_code(401);
                echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
                exit;
            }
            
            $effectiveUserId = resolveWorkspaceUserId($baseDir);
            // ====================================================================
            // Dispatch des routes spéciales DELETE
            handleArchiveRoutes($method, $fullPath, $baseDir, $userId, $effectiveUserId);
            handlePhytoTreatmentRoutes($method, $file, $fullPath, $baseDir, $userId, $effectiveUserId);
            handleInventoryActionRoutes($method, $_GET['action'] ?? null, $fullPath, $baseDir, $userId, $effectiveUserId);
            
            
            // ACTION SPÉCIALE : Suppression d'une parcelle spécifique dans un travail au champ ou traitement
            if (isset($_GET['action']) && $_GET['action'] === 'remove_parcel') {
                // Pour les travaux aux champs : travaux_aux_champs_id requis
                // Pour les traitements phyto : event_id requis
                $workId = null;
                $parcelId = null;
                
                if (isset($_GET['travaux_aux_champs_id'])) {
                    $workId = $_GET['travaux_aux_champs_id'];
                } elseif (isset($_GET['event_id'])) {
                    $workId = $_GET['event_id'];
                }
                
                if (isset($_GET['id_parcel'])) {
                    $parcelId = intval($_GET['id_parcel']);
                }
                
                if (!$workId || !$parcelId) {
                    http_response_code(400);
                    echo json_encode([
                        'error' => 'Paramètres travaux_aux_champs_id ou event_id ET id_parcel requis.',
                        'provided' => [
                            'travaux_aux_champs_id' => $_GET['travaux_aux_champs_id'] ?? 'missing',
                            'event_id' => $_GET['event_id'] ?? 'missing',
                            'id_parcel' => $_GET['id_parcel'] ?? 'missing'
                        ]
                    ]);
                    exit;
                }
                
                if (!is_file($fullPath)) {
                    http_response_code(404);
                    echo json_encode(['error' => 'Fichier non trouvé.']);
                    exit;
                }
                
                $content = file_get_contents($fullPath);
                $data = json_decode($content, true);
                
                if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
                    http_response_code(400);
                    echo json_encode(['error' => 'Fichier JSON invalide.']);
                    exit;
                }
                
                $found = false;
                foreach ($data as &$entry) {
                    // Trouver l'entrée correspondante (travail au champ ou traitement phyto)
                    $isMatch = false;
                    $isFieldWork = false;
                    $isPhytoTreatment = false;
                    
                    if (isset($entry['travaux_aux_champs_id']) && $entry['travaux_aux_champs_id'] === $workId) {
                        $isMatch = true;
                        $isFieldWork = true;
                    } elseif (isset($entry['event_id']) && $entry['event_id'] === $workId) {
                        $isMatch = true;
                        $isPhytoTreatment = true;
                    }
                    
                    if ($isMatch) {
                        // Traiter les parcels_concerned selon le type
                        if (isset($entry['parcels_concerned'])) {

                            if ($isPhytoTreatment) {
                                // Pour les traitements phyto : structure plate (ou backward-compat double-wrapped)
                                $parcels = $entry['parcels_concerned'];
                                if (isset($parcels[0]) && is_array($parcels[0]) && isset($parcels[0][0])) {
                                    // legacy double-wrapped — unwrap for filter then re-flat
                                    $parcels = $parcels[0];
                                }
                                if (is_array($parcels)) {
                                    $originalCount = count($parcels);
                                    $filtered = array_values(array_filter(
                                        $parcels,
                                        function($parcel) use ($parcelId) {
                                            $pid = $parcel['parcel_id'] ?? $parcel['parcels_id'] ?? null;
                                            return $pid != $parcelId;
                                        }
                                    ));

                                    if (count($filtered) < $originalCount) {
                                        $found = true;
                                        if (empty($filtered)) {
                                            unset($entry['parcels_concerned']);
                                        } else {
                                            $entry['parcels_concerned'] = $filtered;
                                        }
                                    }
                                }
                            } elseif ($isFieldWork) {
                                // Pour les travaux aux champs : parcels_concerned est directement un tableau
                                if (is_array($entry['parcels_concerned'])) {
                                    $originalCount = count($entry['parcels_concerned']);
                                    $entry['parcels_concerned'] = array_values(array_filter(
                                        $entry['parcels_concerned'],
                                        function($parcel) use ($parcelId) {
                                            return isset($parcel['parcels_id']) && $parcel['parcels_id'] != $parcelId;
                                        }
                                    ));
                                    
                                    if (count($entry['parcels_concerned']) < $originalCount) {
                                        $found = true;
                                        // Si plus aucune parcelle, supprimer complètement parcels_concerned
                                        if (empty($entry['parcels_concerned'])) {
                                            unset($entry['parcels_concerned']);
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
                
                if ($found) {
                    atomicWriteJsonFile($fullPath, $data);
                    echo json_encode([
                        'success' => true, 
                        'message' => "Parcelle $parcelId supprimée du travail/traitement $workId"
                    ]);
                } else {
                    http_response_code(404);
                    echo json_encode([
                        'error' => "Parcelle $parcelId non trouvée dans le travail/traitement $workId"
                    ]);
                }
                exit;
            }
            
            // SUPPRESSION STANDARD par ID
            parse_str(file_get_contents("php://input"), $deleteParams);
            $idKeys = ['id', 'event_id', 'travaux_aux_champs_id', 'crop_id', 'id_user', 'id_operator', 'idGestionDesOperations', 'parcel_id','id_parcel', 'component_id'];
            $id = null;
            $idKeyUsed = null;
                    
            foreach ($idKeys as $key) {
                if (isset($_GET[$key])) {
                    $id = $_GET[$key];
                    $idKeyUsed = $key;
                    break;
                }
                if (isset($deleteParams[$key])) {
                    $id = $deleteParams[$key];
                    $idKeyUsed = $key;
                    break;
                }
            }

            if ($id === null) {
                http_response_code(400);
                echo json_encode([
                  'error' => 'Paramètre id, event_id, travaux_aux_champs_id, crop_id, id_user, id_operator, idGestionDesOperations, parcel_id, id_parcel ou component_id manquant pour la suppression.'
                ]);
                exit;
            }
            
            $isPhytoTreatmentFile = (strpos($file, 'phyto_treatments') !== false);
            if (is_file($fullPath)) {
                $content = file_get_contents($fullPath);
                $data = json_decode($content, true);

                if (json_last_error() === JSON_ERROR_NONE && is_array($data)) {
                    $found = false;
                    $newData = [];
                    foreach ($data as $entry) {
                        $shouldDelete = false;
                        
                        // Vérifier les différents champs possibles selon le type de fichier
                        if (is_array($entry)) {
                            // Pour les traitements phyto et travaux au champ (event_id)
                            if ($idKeyUsed === 'event_id' && isset($entry['event_id']) && $entry['event_id'] == $id) {
                                $shouldDelete = true;
                                
                                // Supprimer aussi cet événement de l'inventaire (uniquement pour les traitements phyto)
                                if ($isPhytoTreatmentFile) {
                                    $inventoryPath = $baseDir . 'exploitation/inventories.json';
                                    if (is_file($inventoryPath)) {
                                        $inventoryContent = file_get_contents($inventoryPath);
                                        $inventories = json_decode($inventoryContent, true);
                                        if (json_last_error() === JSON_ERROR_NONE && is_array($inventories)) {
                                            foreach ($inventories as &$inventory) {
                                                if (isset($inventory['event_history'])) {
                                                    $inventory['event_history'] = array_filter(
                                                        $inventory['event_history'],
                                                        function($event) use ($id) {
                                                            return $event['event_id'] !== $id;
                                                        }
                                                    );
                                                    $inventory['event_history'] = array_values($inventory['event_history']);
                                                    $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
                                                }
                                            }
                                            file_put_contents($inventoryPath, json_encode($inventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                                        }
                                    }
                                }
                            }
                            // Pour les travaux aux champs (backward compat: travaux_aux_champs_id OU event_id après migration)
                            elseif ($idKeyUsed === 'travaux_aux_champs_id' &&
                                ((isset($entry['travaux_aux_champs_id']) && $entry['travaux_aux_champs_id'] == $id) ||
                                 (isset($entry['event_id']) && $entry['event_id'] == $id))) {
                                $shouldDelete = true;
                            }
                            // Pour les autres types d'ID
                            elseif (
                                (isset($entry['id']) && $entry['id'] == $id) ||
                                (isset($entry['crop_id']) && $entry['crop_id'] == $id) ||
                                (isset($entry['idGestionDesOperations']) && $entry['idGestionDesOperations'] == $id) ||
                                (isset($entry['id_operator']) && $entry['id_operator'] == $id) ||
                                (isset($entry['id_parcel']) && $entry['id_parcel'] == $id) ||
                                (isset($entry['id_user']) && $entry['id_user'] == $id) ||
                                (isset($entry['component_id']) && $entry['component_id'] == $id)
                            ) {
                                $shouldDelete = true;
                                
                                //  SUPPRESSION EN CASCADE POUR LES CULTURES
                                if ($idKeyUsed === 'crop_id' && (strpos($file, 'crops.json') !== false || strpos($file, 'crops/crops.json') !== false)) {
                                    
                                    // Déclencher la suppression en cascade
                                    $cascadeResult = removeCropFromParcelsLists($id, $effectiveUserId);
                                    
                                    // Sauvegarder le résultat de cascade pour l'afficher dans la réponse
                                    $GLOBALS['cascade_result'] = $cascadeResult;
                                }
                            }
                        }
                        
                        if ($shouldDelete) {
                            $found = true;
                            continue;
                        }
                        $newData[] = $entry;
                    }
                    
                    if ($found) {
                        atomicWriteJsonFile($fullPath, $newData);
                        
                        //  SYNCHRONISATION AUTOMATIQUE DE L'INVENTAIRE APRÈS SUPPRESSION D'UN TRAITEMENT
                        $isPhytoTreatmentFile = (strpos($file, 'phyto_treatments_final.json') !== false);
                        if ($isPhytoTreatmentFile && $idKeyUsed === 'event_id') {
                            syncInventoryAfterTreatmentDeletion($id, $effectiveUserId);
                        }
                        
                        // Préparer la réponse de débogage
                        $debugInfo = [
                            'deleted_id' => $id,
                            'deleted_key' => $idKeyUsed,
                            'file' => $file,
                            'cascade_triggered' => false
                        ];
                        
                        // Vérifier si le cascade a été déclenché
                        if ($idKeyUsed === 'crop_id' && (strpos($file, 'crops.json') !== false || strpos($file, 'crops/crops.json') !== false)) {
                            $debugInfo['cascade_triggered'] = true;
                            $debugInfo['cascade_info'] = 'Suppression en cascade déclenchée pour crop_id';
                            
                            // Inclure les résultats de cascade s'ils existent
                            if (isset($GLOBALS['cascade_result'])) {
                                $debugInfo['cascade_result'] = $GLOBALS['cascade_result'];
                            }
                        }
                        
                        echo json_encode(['success' => true] + $debugInfo);
                    } else {
                        http_response_code(404);
                        echo json_encode([
                          'error' => "Aucune entrée trouvée avec $idKeyUsed = $id.",
                          'debug' => 'Vérifiez la structure de vos objets dans le fichier.',
                          'available_entries' => array_map(function($entry) {
                              $ids = [];
                              if (isset($entry['id'])) $ids['id'] = $entry['id'];
                              if (isset($entry['event_id'])) $ids['event_id'] = $entry['event_id'];
                              if (isset($entry['travaux_aux_champs_id'])) $ids['travaux_aux_champs_id'] = $entry['travaux_aux_champs_id'];
                              if (isset($entry['crop_id'])) $ids['crop_id'] = $entry['crop_id'];
                              return $ids;
                          }, array_slice($data, 0, 3)) // Afficher seulement les 3 premiers pour debug
                        ]);
                    }
                    exit;
                } else {
                    http_response_code(400);
                    echo json_encode(['error' => 'Le fichier n\'est pas un tableau JSON valide.']);
                    exit;
                }
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Fichier non trouvé.']);
                exit;
            }
            
        // ====================================================================
        // MÉTHODE PUT - MISE À JOUR DE DONNÉES
        // ====================================================================
        } elseif ($method === 'PUT') {
            
            // Authentifier l'utilisateur pour tous les PUT
            $userId = authenticateAndGetUserId();
            if (!$userId) {
                http_response_code(401);
                echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
                exit;
            }
            // Résoudre l'id_user effectif : workspace owner si on est dans l'espace d'un autre compte
            $effectiveUserId = resolveWorkspaceUserId($baseDir);
            
            // ACTIONS SPÉCIALES EN PRIORITÉ
            $action = $_GET['action'] ?? null;

            // Dispatch des routes spéciales PUT
            handleTreatmentActionRoutes($action, $file, $fullPath, $baseDir);
            handlePhytoTreatmentRoutes($method, $file, $fullPath, $baseDir, $userId, $effectiveUserId);
            handleInventoryActionRoutes($method, $action, $fullPath, $baseDir, $userId, $effectiveUserId);
            
            // Action: migration/normalisation de tous les travaux au champ vers la nouvelle structure
            if ($action === 'normalize_field_works') {
                if (is_file($fullPath)) {
                    $fwContent = file_get_contents($fullPath);
                    $fwData = json_decode($fwContent, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($fwData)) {
                        $normalizedCount = 0;
                        foreach ($fwData as &$fw) {
                            normalizeFieldWorkStructure($fw);
                            $normalizedCount++;
                        }
                        unset($fw);
                        atomicWriteJsonFile($fullPath, $fwData);
                        echo json_encode(['success' => true, 'normalized_count' => $normalizedCount]);
                        exit;
                    }
                }
                echo json_encode(['success' => true, 'normalized_count' => 0, 'message' => 'Fichier non trouvé ou vide']);
                exit;
            }

            // Action: réinitialiser les parcelles d'un travail au champ (avant rechargement pour modification)
            if ($action === 'reset_field_work_parcels') {
                $workId = $_GET['event_id'] ?? $_GET['travaux_aux_champs_id'] ?? null;
                if (!$workId) {
                    http_response_code(400);
                    echo json_encode(['error' => 'Paramètre event_id ou travaux_aux_champs_id requis.']);
                    exit;
                }
                if (is_file($fullPath)) {
                    $fwContent = file_get_contents($fullPath);
                    $fwData = json_decode($fwContent, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($fwData)) {
                        foreach ($fwData as &$fw) {
                            $matches = (isset($fw['event_id']) && $fw['event_id'] === $workId)
                                    || (isset($fw['travaux_aux_champs_id']) && $fw['travaux_aux_champs_id'] === $workId);
                            if ($matches) {
                                $fw['parcels_concerned'] = [];
                            }
                        }
                        unset($fw);
                        atomicWriteJsonFile($fullPath, $fwData);
                        echo json_encode(['success' => true]);
                        exit;
                    }
                }
                echo json_encode(['success' => false, 'message' => 'Fichier non trouvé']);
                exit;
            }

            // MISE À JOUR STANDARD d'une entrée (seulement si pas d'action spéciale)
            if (!isset($_GET['action'])) {
                $input = file_get_contents('php://input');
            $updateData = json_decode($input, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                http_response_code(400);
                echo json_encode(['error' => 'Corps JSON invalide.']);
                exit;
            }
            
            $updateData['id_user'] = $effectiveUserId; // Utiliser l'ID effectif (workspace owner ou user connecté)
            
            // PROTECTION SPÉCIALE POUR LES PARCELLES : Retirer id_parcel des données d'update
            // pour éviter qu'il soit modifié accidentellement, SEULEMENT si id_parcel est présent dans GET
            if (strpos($file, 'parcels.json') !== false && isset($updateData['id_parcel']) && isset($_GET['id_parcel'])) {
                $removedParcelId = $updateData['id_parcel'];
                unset($updateData['id_parcel']);
            }
            
            // Normaliser les travaux au champ vers la nouvelle structure de champs (PUT)
            if (strpos($file, 'field_works.json') !== false) {
                normalizeFieldWorkStructure($updateData);
            }

            // Déterminer quelle clé utiliser pour la recherche
            $searchKey = null;
            $searchValue = null;
            
            //  PRIORITÉ SPÉCIALE POUR LES PARCELLES : id_parcel en premier pour exploitation/parcels.json
            if (strpos($file, 'parcels.json') !== false) {
                $possibleKeys = ['id_parcel', 'event_id', 'travaux_aux_champs_id', 'crop_id', 'id_operator', 'idGestionDesOperations', 'id_user', 'id'];
            } else {
                $possibleKeys = ['event_id', 'travaux_aux_champs_id', 'crop_id', 'id_operator', 'idGestionDesOperations', 'id_parcel', 'id_user', 'id'];
            }
            
            // Passe 1 : chercher uniquement dans les paramètres GET (URL)
            foreach ($possibleKeys as $key) {
                if (isset($_GET[$key])) {
                    $searchKey = $key;
                    $searchValue = $_GET[$key];
                    break;
                }
            }
            // Passe 2 : fallback sur le body JSON, seulement si rien trouvé en GET
            if ($searchKey === null) {
                foreach ($possibleKeys as $key) {
                    if (isset($updateData[$key]) && $key !== 'id_user') {
                        $searchKey = $key;
                        $searchValue = $updateData[$key];
                        break;
                    }
                }
                // id_user en dernier recours uniquement
                if ($searchKey === null && isset($updateData['id_user'])) {
                    $searchKey = 'id_user';
                    $searchValue = $updateData['id_user'];
                }
            }
            
            if ($searchKey === null || $searchValue === null) {
                http_response_code(400);
                echo json_encode(['error' => 'Paramètre event_id, travaux_aux_champs_id, crop_id, id_user, id_parcel ou id manquant.']);
                exit;
            }
            
            if (is_file($fullPath)) {
                $content = file_get_contents($fullPath);
                $data = json_decode($content, true);
                if (!is_array($data)) {
                    http_response_code(400);
                    echo json_encode(['error' => 'Fichier JSON invalide.']);
                    exit;
                }
                
                $found = false;
                $updated = null;
                
                foreach ($data as &$entry) {
                    // Backward compat: search by travaux_aux_champs_id also matches event_id (field_works after migration)
                    $entryMatchesKey = isset($entry[$searchKey]) && $entry[$searchKey] == $searchValue;
                    if (!$entryMatchesKey && $searchKey === 'travaux_aux_champs_id' && isset($entry['event_id']) && $entry['event_id'] == $searchValue) {
                        $entryMatchesKey = true;
                    }
                    if ($entryMatchesKey) {
                        //  RÉCUPÉRER L'ANCIEN NOM DE PARCELLE AVANT MODIFICATION (pour crops.json)
                        $oldParcelNameBeforeUpdate = null;
                        if ($searchKey === 'id_parcel' && strpos($file, 'parcels.json') !== false) {
                            $oldParcelNameBeforeUpdate = $entry['parcel_name'] ?? $entry['name'] ?? null;
                        }
                        
                        //  PRÉSERVATION DES MÉTADONNÉES AVANT FUSION (spécial phyto_treatments_final.json)
                        $preservedMetadata = [];
                        if ($searchKey === 'event_id' && strpos($file, 'phyto_treatments_final.json') !== false) {
                            $preservedMetadata = [
                                'operator_id' => $entry['operator_id'] ?? null,
                                'operator_name' => $entry['operator_name'] ?? null,
                                'operator_phytolicence' => $entry['operator_phytolicence'] ?? $entry['operator_pl'] ?? null,
                                'target' => $entry['target'] ?? $entry['ciblee'] ?? null,
                                'remark' => $entry['remark'] ?? $entry['remarque'] ?? null,
                                'bbch' => $entry['bbch'] ?? null,
                                'event_hour' => $entry['event_hour'] ?? null,
                                'date' => $entry['date'] ?? $entry['event_date'] ?? null,
                                'harvest_date' => $entry['harvest_date'] ?? null,
                                'produit_humidite' => $entry['produit_humidite'] ?? null,
                                'temperature' => $entry['temperature'] ?? null,
                                'vitesse_vent' => $entry['vitesse_vent'] ?? null,
                                'humidite_vent' => $entry['humidite_vent'] ?? null,
                                'autres_remarques' => $entry['autres_remarques'] ?? null,
                                'localized_treatment' => $entry['localized_treatment'] ?? $entry['traitementLocal'] ?? null,
                                'clean_flag' => $entry['clean_flag'] ?? $entry['effectuerNottoyage'] ?? null
                            ];
                        }
                        
                        // PRÉSERVATION DE L'ID ORIGINAL LORS DE LA MODIFICATION
                        $originalId = null;
                        if ($searchKey === 'id_parcel' && strpos($file, 'parcels.json') !== false) {
                            $originalId = $entry['id_parcel'] ?? null;
                        }
                        
                        // Fusionner les nouvelles données avec les anciennes
                        $entry = array_merge($entry, $updateData);
                        
                        //  RESTAURER L'ID ORIGINAL POUR ÉVITER LA CRÉATION D'UNE NOUVELLE ENTRÉE
                        if ($originalId && $searchKey === 'id_parcel' && strpos($file, 'parcels.json') !== false) {
                            $entry['id_parcel'] = $originalId;
                        }
                        
                        //  CRÉATION DU CHAMP SIGEC_CODE S'IL N'EXISTE PAS (pour parcelles)
                        if ($searchKey === 'id_parcel' && strpos($file, 'parcels.json') !== false) {
                            if (!isset($entry['sigec_code'])) {
                                $entry['sigec_code'] = $updateData['sigec_code'] ?? '';
                            }
                        }
                        
                        if (($searchKey === 'event_id' && strpos($file, 'phyto_treatments_final.json') !== false)) {
                            
                            //  DÉTECTION SPÉCIALE : Modification de répartition (parcelles ou surfaces)
                            $isDistributionUpdate = false;
                            if (isset($updateData['parcels_concerned']) || 
                                (is_array($updateData) && array_key_exists('parcels_concerned', $updateData))) {
                                $isDistributionUpdate = true;
                            }
                            
                            // Vérifier aussi s'il y a des modifications de surface dans les données
                            if (!$isDistributionUpdate && is_array($updateData)) {
                                foreach ($updateData as $key => $value) {
                                    if (strpos($key, 'surface') !== false ||
                                        strpos($key, 'parcel') !== false ||
                                        strpos($key, 'volume') !== false) {
                                        $isDistributionUpdate = true;
                                        break;
                                    }
                                }
                            }
                            
                            if ($isDistributionUpdate) {
                                // Utiliser le recalcul spécialisé pour les modifications de répartition
                                $recalcChanges = recalculateAfterDistributionUpdate($entry);
                            } else {
                                // Force la consolidation complète pour tous les autres PUT sur les traitements phyto
                                consolidateAllTreatmentCalculations($entry);
                            }
                            
                            //  RESTAURER LES MÉTADONNÉES APRÈS CONSOLIDATION
                            foreach ($preservedMetadata as $key => $value) {
                                if ($value !== null && $value !== '') {
                                    $entry[$key] = $value;
                                }
                            }
                        }
                        
                        $found = true;
                        $updated = $entry;
                        
                        // Mettre à jour l'inventaire si c'est un traitement phyto
                        if ($searchKey === 'event_id' && strpos($file, 'phyto_treatments_final.json') !== false) {
                            $inventoryPath = $baseDir . 'exploitation/inventories.json';
                            if (is_file($inventoryPath)) {
                                $inventoryContent = file_get_contents($inventoryPath);
                                $inventories = json_decode($inventoryContent, true);
                                if (json_last_error() === JSON_ERROR_NONE && is_array($inventories)) {
                                    // Préparer les données du nouvel événement pour l'inventaire
                                    $eventForInventory = [
                                        'action' => 'update_inventory_with_event',
                                        'event_id' => $updated['event_id'],
                                        'event_date' => $updated['date'] ?? $updated['event_date'] ?? $updated['treatment_date'] ?? date('Y-m-d'), // Supporter les deux formats
                                        'event_crop' => $updated['target'] ?? $updated['ciblee'] ?? '',
                                        'event_type' => 'treatment', // Traitement phyto = usage
                                        'exploitation_id' => 'default',
                                        'products' => []
                                    ];
                                    
                                    //  CORRECTION: Utiliser treatment_composition (nouvelle structure) au lieu de treatment_components (ancienne)
                                    $treatmentComponents = [];
                                    if (isset($updated['treatment_composition']) && is_array($updated['treatment_composition'])) {
                                        // Flat structure; backward-compat double-wrapped unwrap
                                        if (isset($updated['treatment_composition'][0]) && is_array($updated['treatment_composition'][0]) && isset($updated['treatment_composition'][0][0])) {
                                            $treatmentComponents = $updated['treatment_composition'][0];
                                        } else {
                                            $treatmentComponents = $updated['treatment_composition'];
                                        }
                                    } elseif (isset($updated['treatment_components']) && is_array($updated['treatment_components'])) {
                                        // Ancienne structure: fallback
                                        $treatmentComponents = is_array($updated['treatment_components']) ? $updated['treatment_components'] : [$updated['treatment_components']];
                                    }
                                                                        
                                    foreach ($treatmentComponents as $component) {
                                        if (isset($component['component_id']) && isset($component['component_quantity']) && 
                                            floatval($component['component_quantity']) > 0) {
                                            $productData = [
                                                'product_id' => $component['component_id'],
                                                'product_name' => $component['component_name'] ?? 'Produit inconnu',
                                                'product_numaut' => $component['component_numaut'] ?? '',
                                                'quantity_used' => floatval($component['component_quantity']),
                                                'quantity_used_unit'=> $component['component_quantity_unity'] ?? 'L'
                                            ];
                                            $eventForInventory['products'][] = $productData;
                                        }
                                    }
                                    
                                    
                                    if (!empty($eventForInventory['products'])) {
                                        //  FIX: updateInventoryWithEventDirect modifie $inventories par référence et retourne boolean
                                        $updateResult = updateInventoryWithEventDirect($inventories, $eventForInventory, $effectiveUserId);
                                        if ($updateResult) {
                                            // Écrire les inventaires modifiés, pas le résultat booléen
                                            file_put_contents($inventoryPath, json_encode($inventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                                        }
                                    }
                                }
                            }
                        }
                        
                        //  MISE À JOUR AUTOMATIQUE DE CROPS.JSON lors de la modification d'une parcelle
                        if ($searchKey === 'id_parcel' && strpos($file, 'parcels.json') !== false) {
                            
                            // Utiliser l'ancien nom récupéré avant modification
                            $oldParcelName = $oldParcelNameBeforeUpdate;
                            $newParcelName = isset($updateData['parcel_name']) ? $updateData['parcel_name'] : null;
                                                        
                            if ($oldParcelName && $newParcelName && $oldParcelName !== $newParcelName) {
                                // Note: crops.json parcels_id now stores id_parcel UUIDs (stable),
                                // so no name propagation needed there.
                                
                                // Mettre à jour le nom affiché dans les traitements phytosanitaires
                                $treatmentFiles = [
                                    $baseDir . 'events/phyto_treatments_final.json',
                                    $baseDir . 'events/phyto_treatments.json'
                                ];
                                
                                $treatmentsUpdated = 0;
                                foreach ($treatmentFiles as $treatmentFile) {
                                    if (is_file($treatmentFile)) {
                                        $treatmentContent = file_get_contents($treatmentFile);
                                        $treatments = json_decode($treatmentContent, true);
                                        
                                        if (json_last_error() === JSON_ERROR_NONE && is_array($treatments)) {
                                            $fileUpdated = 0;
                                            
                                            foreach ($treatments as &$treatment) {
                                                // Filtrer uniquement les traitements appartenant à l'utilisateur connecté
                                                if (isset($treatment['id_user']) && $treatment['id_user'] !== $effectiveUserId) {
                                                    continue;
                                                }
                                                if (isset($treatment['parcels_concerned']) && is_array($treatment['parcels_concerned'])) {
                                                    $modified = false;
                                                    $flatParcels = $treatment['parcels_concerned'];
                                                    if (isset($flatParcels[0]) && is_array($flatParcels[0]) && isset($flatParcels[0][0])) {
                                                        $flatParcels = $flatParcels[0];
                                                    }
                                                    foreach ($flatParcels as &$parcel) {
                                                        $pn = $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? null;
                                                        if ($pn === $oldParcelName) {
                                                            $parcel['parcel_name'] = $newParcelName;
                                                            unset($parcel['parcels_name']);
                                                            $modified = true;
                                                        }
                                                    }
                                                    unset($parcel);
                                                    $treatment['parcels_concerned'] = $flatParcels;

                                                    if ($modified) {
                                                        $treatment['updated_parcel_name_at'] = date('c');
                                                        $fileUpdated++;
                                                        $treatmentsUpdated++;
                                                    }
                                                }
                                            }
                                            
                                            if ($fileUpdated > 0) {
                                                file_put_contents($treatmentFile, json_encode($treatments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        break;
                    }
                }
                
                if ($found) {
                    atomicWriteJsonFile($fullPath, $data);
                    echo json_encode(['success' => true, 'updated' => $updated, 'search_key' => $searchKey, 'search_value' => $searchValue]);
                } else {
                    http_response_code(404);
                    echo json_encode([
                        'error' => "$searchKey $searchValue non trouvé.",
                        'debug' => 'Vérifiez que l\'entrée existe dans le fichier.',
                        'available_entries' => array_map(function($entry) use ($searchKey) {
                            return isset($entry[$searchKey]) ? $entry[$searchKey] : 'N/A';
                        }, array_slice($data, 0, 5)) // Afficher les 5 premiers IDs pour debug
                    ]);
                }
                exit;
            }
            // Fin de la section MISE À JOUR STANDARD (seulement si pas d'action spéciale)
        }
        }
    }
}

http_response_code(404);
echo json_encode(['error' => 'Fichier JSON/GeoJSON non trouvé ou nom invalide.']);
?>
