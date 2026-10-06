<?php
/**
 * Fonctions utilitaires pour la gestion de l'archivage des cultures
 */

/**
 * Extrait l'année de la date de semis pour créer la collection
 * @param string $sowingDate Date de semis au format YYYY-MM-DD
 * @return string L'année ou "Cultures" si pas de date
 */
function extractCollectionFromSowingDate($sowingDate) {
    if (empty($sowingDate) || $sowingDate === '' || $sowingDate === 'null') {
        return 'Cultures';
    }
    
    // Essayer d'extraire l'année
    if (preg_match('/^(\d{4})/', $sowingDate, $matches)) {
        return $matches[1];
    }
    
    // Essayer avec DateTime
    try {
        $date = new DateTime($sowingDate);
        return $date->format('Y');
    } catch (Exception $e) {
        return 'Cultures';
    }
}

/**
 * Enrichit une culture avec les champs is_archived et collection si manquants
 * @param array &$crop La culture à enrichir (passée par référence)
 */
function enrichCropWithArchiveFields(&$crop) {
    // Ajouter is_archived si manquant (false par défaut pour les cultures actives)
    if (!isset($crop['is_archived'])) {
        $crop['is_archived'] = false;
    }
    
    // Ajouter collection si manquant
    if (!isset($crop['collection'])) {
        $sowingDate = $crop['sowing_date'] ?? '';
        $crop['collection'] = extractCollectionFromSowingDate($sowingDate);
    }
}

/**
 * Migre toutes les cultures existantes pour ajouter/renommer les champs
 * @param array &$crops Liste des cultures (passée par référence)
 * @return int Nombre de cultures migrées
 */
function migrateCropsWithArchiveFields(&$crops) {
    $migratedCount = 0;
    
    if (!is_array($crops)) {
        return 0;
    }

    // Renommages de champs (idempotents)
    $fieldMap = [
        'nomPhytoweb_crops_id' => 'phytoweb_name',
        'phytoweb_crops_id'    => 'phytoweb_id',
        'EPPOCode'             => 'eppo',
        'isArchived'           => 'is_archived',
    ];

    foreach ($crops as &$crop) {
        $wasModified = false;

        foreach ($fieldMap as $old => $new) {
            if (array_key_exists($old, $crop) && !array_key_exists($new, $crop)) {
                $crop[$new] = $crop[$old];
                unset($crop[$old]);
                $wasModified = true;
            }
        }
        
        if (!isset($crop['is_archived'])) {
            $crop['is_archived'] = false;
            $wasModified = true;
        }
        
        if (!isset($crop['collection'])) {
            $sowingDate = $crop['sowing_date'] ?? '';
            $crop['collection'] = extractCollectionFromSowingDate($sowingDate);
            $wasModified = true;
        }
        
        if ($wasModified) {
            $migratedCount++;
        }
    }
    
    return $migratedCount;
}

/**
 * Déplace une culture vers le fichier d'archive
 * @param string $cropId L'ID de la culture à archiver
 * @param string $collection La collection de destination
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return array Résultat de l'opération
 */
function archiveCrop($cropId, $collection, $userId, $baseDir) {
    $cropsPath = $baseDir . 'crops/crops.json';
    $archivePath = $baseDir . 'crops/cropsArchive.json';
    
    // Charger les cultures actives
    $crops = [];
    if (file_exists($cropsPath)) {
        $content = file_get_contents($cropsPath);
        $crops = json_decode($content, true) ?: [];
    }
    
    // Charger les archives existantes
    $archives = [];
    if (file_exists($archivePath)) {
        $content = file_get_contents($archivePath);
        $archives = json_decode($content, true) ?: [];
    }
    
    // Trouver la culture à archiver
    $cropToArchive = null;
    $cropIndex = null;
    
    foreach ($crops as $index => $crop) {
        if (isset($crop['crop_id']) && $crop['crop_id'] === $cropId) {
            // Vérifier que la culture appartient à l'utilisateur
            if (isset($crop['id_user']) && $crop['id_user'] === $userId) {
                $cropToArchive = $crop;
                $cropIndex = $index;
                break;
            }
        }
    }
    
    if ($cropToArchive === null) {
        return [
            'success' => false,
            'error' => 'Culture non trouvée ou accès non autorisé'
        ];
    }
    
    // Mettre à jour les champs d'archivage
    $cropToArchive['is_archived'] = true;
    $cropToArchive['collection'] = $collection;
    $cropToArchive['archived_at'] = date('c');
    
    // Ajouter à l'archive
    $archives[] = $cropToArchive;
    
    // Retirer des cultures actives
    array_splice($crops, $cropIndex, 1);
    
    // Sauvegarder les deux fichiers
    $cropsWritten = atomicWriteJsonFileSafe($cropsPath, $crops);
    $archiveWritten = atomicWriteJsonFileSafe($archivePath, $archives);
    
    if ($cropsWritten && $archiveWritten) {
        // Mettre à jour les traitements phytosanitaires avec le nouveau statut d'archivage
        $treatmentsUpdated = updateCropArchiveStatusInTreatments($cropId, true, $collection, $userId, $baseDir);
        
        return [
            'success' => true,
            'message' => 'Culture archivée avec succès',
            'archived_crop' => $cropToArchive,
            'treatments_updated' => $treatmentsUpdated
        ];
    } else {
        return [
            'success' => false,
            'error' => 'Erreur lors de la sauvegarde des fichiers'
        ];
    }
}

/**
 * Récupère toutes les collections existantes pour un utilisateur
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return array Liste des collections uniques
 */
function getUserCollections($userId, $baseDir) {
    $collections = [];
    
    $cropsPath = $baseDir . 'crops/crops.json';
    $archivePath = $baseDir . 'crops/cropsArchive.json';
    
    // Parcourir crops.json
    if (file_exists($cropsPath)) {
        $content = file_get_contents($cropsPath);
        $crops = json_decode($content, true) ?: [];
        
        foreach ($crops as $crop) {
            if (isset($crop['id_user']) && $crop['id_user'] === $userId) {
                // Si la collection existe, l'utiliser
                if (isset($crop['collection']) && !empty($crop['collection'])) {
                    $collections[$crop['collection']] = true;
                } else {
                    // Sinon, extraire l'année de la date de semis comme collection suggérée
                    $sowingDate = $crop['sowing_date'] ?? '';
                    $suggestedCollection = extractCollectionFromSowingDate($sowingDate);
                    if ($suggestedCollection && $suggestedCollection !== 'Cultures') {
                        $collections[$suggestedCollection] = true;
                    }
                }
            }
        }
    }
    
    // Parcourir cropsArchive.json
    if (file_exists($archivePath)) {
        $content = file_get_contents($archivePath);
        $archives = json_decode($content, true) ?: [];
        
        foreach ($archives as $crop) {
            if (isset($crop['id_user']) && $crop['id_user'] === $userId) {
                if (isset($crop['collection']) && !empty($crop['collection'])) {
                    $collections[$crop['collection']] = true;
                }
            }
        }
    }
    
    // Trier les collections (les années en premier, puis alphabétique)
    $result = array_keys($collections);
    usort($result, function($a, $b) {
        $aIsYear = preg_match('/^\d{4}$/', $a);
        $bIsYear = preg_match('/^\d{4}$/', $b);
        
        if ($aIsYear && $bIsYear) {
            return $b <=> $a; // Années décroissantes
        }
        if ($aIsYear) return -1;
        if ($bIsYear) return 1;
        return strcasecmp($a, $b);
    });
    
    return $result;
}

/**
 * Récupère les cultures archivées d'un utilisateur
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return array Liste des cultures archivées
 */
function getUserArchivedCrops($userId, $baseDir) {
    $archivePath = $baseDir . 'crops/cropsArchive.json';
    
    if (!file_exists($archivePath)) {
        return [];
    }
    
    $content = file_get_contents($archivePath);
    $archives = json_decode($content, true) ?: [];
    
    // Filtrer par utilisateur
    $userArchives = array_filter($archives, function($crop) use ($userId) {
        return isset($crop['id_user']) && $crop['id_user'] === $userId;
    });
    
    return array_values($userArchives);
}

/**
 * Écriture atomique sécurisée d'un fichier JSON
 * @param string $path Chemin du fichier
 * @param array $data Données à écrire
 * @return bool Succès de l'opération
 */
function atomicWriteJsonFileSafe($path, $data) {
    // Créer le répertoire si nécessaire
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    
    $jsonData = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    $tmpFile = $path . '.tmp';
    
    $fp = fopen($tmpFile, 'wb');
    if (!$fp) {
        return false;
    }
    
    $writeSuccess = false;
    if (flock($fp, LOCK_EX)) {
        $writeSuccess = fwrite($fp, $jsonData) !== false;
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    
    if ($writeSuccess && file_exists($tmpFile)) {
        if (rename($tmpFile, $path)) {
            return true;
        }
        // Fallback
        if (file_exists($tmpFile)) {
            unlink($tmpFile);
        }
        return file_put_contents($path, $jsonData) !== false;
    }
    
    if (file_exists($tmpFile)) {
        unlink($tmpFile);
    }
    return false;
}

/**
 * Restaure une culture archivée vers les cultures actives
 * @param string $cropId L'ID de la culture à restaurer
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return array Résultat de l'opération
 */
function restoreCrop($cropId, $userId, $baseDir) {
    $cropsPath = $baseDir . 'crops/crops.json';
    $archivePath = $baseDir . 'crops/cropsArchive.json';
    
    // Charger les archives
    $archives = [];
    if (file_exists($archivePath)) {
        $content = file_get_contents($archivePath);
        $archives = json_decode($content, true) ?: [];
    }
    
    // Charger les cultures actives
    $crops = [];
    if (file_exists($cropsPath)) {
        $content = file_get_contents($cropsPath);
        $crops = json_decode($content, true) ?: [];
    }
    
    // Trouver la culture à restaurer
    $cropToRestore = null;
    $cropIndex = null;
    
    foreach ($archives as $index => $crop) {
        if (isset($crop['crop_id']) && $crop['crop_id'] === $cropId) {
            if (isset($crop['id_user']) && $crop['id_user'] === $userId) {
                $cropToRestore = $crop;
                $cropIndex = $index;
                break;
            }
        }
    }
    
    if ($cropToRestore === null) {
        return [
            'success' => false,
            'error' => 'Culture archivée non trouvée ou accès non autorisé'
        ];
    }
    
    // Mettre à jour les champs
    $cropToRestore['is_archived'] = false;
    unset($cropToRestore['archived_at']);
    
    // Ajouter aux cultures actives
    $crops[] = $cropToRestore;
    
    // Retirer des archives
    array_splice($archives, $cropIndex, 1);
    
    // Sauvegarder les deux fichiers
    $cropsWritten = atomicWriteJsonFileSafe($cropsPath, $crops);
    $archiveWritten = atomicWriteJsonFileSafe($archivePath, $archives);
    
    if ($cropsWritten && $archiveWritten) {
        // Mettre à jour les traitements phytosanitaires avec le nouveau statut (non archivé)
        // On garde la collection existante
        $treatmentsUpdated = updateCropArchiveStatusInTreatments($cropId, false, $cropToRestore['collection'] ?? '', $userId, $baseDir);
        
        return [
            'success' => true,
            'message' => 'Culture restaurée avec succès',
            'restored_crop' => $cropToRestore,
            'treatments_updated' => $treatmentsUpdated
        ];
    } else {
        return [
            'success' => false,
            'error' => 'Erreur lors de la sauvegarde des fichiers'
        ];
    }
}

/**
 * Supprime définitivement une culture archivée
 * @param string $cropId L'ID de la culture à supprimer
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return array Résultat de l'opération
 */
function deleteArchivedCrop($cropId, $userId, $baseDir) {
    $archivePath = $baseDir . 'crops/cropsArchive.json';
    
    // Charger les archives
    $archives = [];
    if (file_exists($archivePath)) {
        $content = file_get_contents($archivePath);
        $archives = json_decode($content, true) ?: [];
    }
    
    // Trouver la culture à supprimer
    $cropIndex = null;
    $cropToDelete = null;
    
    foreach ($archives as $index => $crop) {
        if (isset($crop['crop_id']) && $crop['crop_id'] === $cropId) {
            if (isset($crop['id_user']) && $crop['id_user'] === $userId) {
                $cropToDelete = $crop;
                $cropIndex = $index;
                break;
            }
        }
    }
    
    if ($cropToDelete === null) {
        return [
            'success' => false,
            'error' => 'Culture archivée non trouvée ou accès non autorisé',
            'code' => 404
        ];
    }
    
    // Retirer des archives
    array_splice($archives, $cropIndex, 1);
    
    // Sauvegarder le fichier
    $archiveWritten = atomicWriteJsonFileSafe($archivePath, $archives);
    
    if ($archiveWritten) {
        return [
            'success' => true,
            'message' => 'Culture archivée supprimée définitivement',
            'deleted_crop' => $cropToDelete
        ];
    } else {
        return [
            'success' => false,
            'error' => 'Erreur lors de la sauvegarde du fichier'
        ];
    }
}

/**
 * Met à jour les informations d'archivage d'une culture dans tous les traitements phytosanitaires
 * @param string $cropId L'ID de la culture
 * @param bool $isArchived Statut d'archivage
 * @param string $collection Collection de la culture
 * @param string $userId L'ID de l'utilisateur
 * @param string $baseDir Le répertoire de base
 * @return int Nombre de traitements mis à jour
 */
function updateCropArchiveStatusInTreatments($cropId, $isArchived, $collection, $userId, $baseDir) {
    $treatmentsPath = $baseDir . 'events/phyto_treatments_final.json';
    
    // Log pour debug
    error_log("updateCropArchiveStatusInTreatments - cropId: $cropId, isArchived: " . ($isArchived ? 'true' : 'false') . ", collection: $collection, userId: $userId");
    error_log("updateCropArchiveStatusInTreatments - treatmentsPath: $treatmentsPath");
    
    if (!file_exists($treatmentsPath)) {
        error_log("updateCropArchiveStatusInTreatments - Fichier non trouvé: $treatmentsPath");
        return 0;
    }
    
    $content = file_get_contents($treatmentsPath);
    $treatments = json_decode($content, true);
    
    if ($treatments === null || !is_array($treatments)) {
        error_log("updateCropArchiveStatusInTreatments - Erreur de décodage JSON ou fichier vide");
        return 0;
    }
    
    error_log("updateCropArchiveStatusInTreatments - Nombre de traitements trouvés: " . count($treatments));
    
    $updatedCount = 0;
    $modified = false;
    
    // Normaliser le cropId pour la comparaison
    $cropIdNormalized = strval($cropId);
    
    foreach ($treatments as &$treatment) {
        // Vérifier que le traitement appartient à l'utilisateur (comparaison non stricte)
        $treatmentUserId = isset($treatment['id_user']) ? strval($treatment['id_user']) : '';
        if ($treatmentUserId !== strval($userId)) {
            continue;
        }
        
        // Parcourir les parcelles concernées (tableau plat après migration)
        if (isset($treatment['parcels_concerned']) && is_array($treatment['parcels_concerned'])) {
            foreach ($treatment['parcels_concerned'] as &$parcel) {
                if (!is_array($parcel)) continue;
                // Vérifier si cette parcelle contient la culture à mettre à jour (comparaison non stricte)
                $parcelCropId = isset($parcel['crop_id']) ? strval($parcel['crop_id']) : '';

                if ($parcelCropId === $cropIdNormalized) {
                    error_log("updateCropArchiveStatusInTreatments - Trouvé crop_id match dans traitement: " . ($treatment['event_id'] ?? 'unknown'));
                    $parcel['is_archived'] = $isArchived;
                    unset($parcel['isArchived']); // remove legacy key
                    $parcel['collection'] = $collection;
                    $modified = true;
                    $updatedCount++;
                }
            }
            unset($parcel);
        }
    }
    
    error_log("updateCropArchiveStatusInTreatments - Parcelles mises à jour: $updatedCount, modified: " . ($modified ? 'true' : 'false'));
    
    // Sauvegarder seulement si des modifications ont été faites
    if ($modified) {
        $writeResult = atomicWriteJsonFileSafe($treatmentsPath, $treatments);
        error_log("updateCropArchiveStatusInTreatments - Résultat de sauvegarde: " . ($writeResult ? 'succès' : 'échec'));
        
        if (!$writeResult) {
            error_log("updateCropArchiveStatusInTreatments - ERREUR: Impossible de sauvegarder $treatmentsPath");
        }
    }
    
    return $updatedCount;
}

// ============================================================================
// ROUTAGE HTTP
// ============================================================================

/**
 * Dispatch les routes HTTP liées aux archives de cultures.
 * Appelle exit() si une route est traitée, sinon retourne sans rien faire.
 */
function handleArchiveRoutes($method, $fullPath, $baseDir, $userId = null, $effectiveUserId = null) {
    $action = $_GET['action'] ?? null;

    if ($method === 'GET') {
        if ($action === 'get_collections') {
            $authUserId = authenticateAndGetUserId();
            if (!$authUserId) {
                http_response_code(401);
                echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
                exit;
            }
            $collections = getUserCollections($authUserId, $baseDir);
            echo json_encode(['success' => true, 'collections' => $collections]);
            exit;
        }

        if ($action === 'get_archived_crops') {
            $authUserId = authenticateAndGetUserId();
            if (!$authUserId) {
                http_response_code(401);
                echo json_encode(['error' => 'Token d\'authentification invalide ou manquant']);
                exit;
            }
            $archivedCrops = getUserArchivedCrops($authUserId, $baseDir);
            echo json_encode($archivedCrops);
            exit;
        }
    }

    if ($method === 'POST') {
        if ($action === 'archive_crop') {
            $input = file_get_contents('php://input');
            $data = json_decode($input, true);
            if (json_last_error() !== JSON_ERROR_NONE || !isset($data['crop_id']) || !isset($data['collection'])) {
                http_response_code(400);
                echo json_encode(['error' => 'Données invalides. crop_id et collection requis.']);
                exit;
            }
            $result = archiveCrop($data['crop_id'], $data['collection'], $effectiveUserId, $baseDir);
            http_response_code($result['success'] ? 200 : 400);
            echo json_encode($result);
            exit;
        }

        if ($action === 'restore_crop') {
            $input = file_get_contents('php://input');
            $data = json_decode($input, true);
            if (json_last_error() !== JSON_ERROR_NONE || !isset($data['crop_id'])) {
                http_response_code(400);
                echo json_encode(['error' => 'Données invalides. crop_id requis.']);
                exit;
            }
            $result = restoreCrop($data['crop_id'], $effectiveUserId, $baseDir);
            http_response_code($result['success'] ? 200 : 400);
            echo json_encode($result);
            exit;
        }
    }

    if ($method === 'DELETE' && $action === 'delete_archived_crop') {
        $cropId = $_GET['crop_id'] ?? null;
        if (!$cropId) {
            http_response_code(400);
            echo json_encode(['error' => 'Paramètre crop_id requis']);
            exit;
        }
        $result = deleteArchivedCrop($cropId, $effectiveUserId, $baseDir);
        http_response_code($result['success'] ? 200 : ($result['code'] ?? 404));
        echo json_encode($result);
        exit;
    }
}

/**
 * Applique toutes les migrations automatiques lors d'un GET sur un fichier JSON.
 * Modifie $data par référence et sauvegarde si nécessaire.
 */
function applyGetMigrations($file, $fullPath, &$data) {
    // --- inventories.json ---
    if (strpos($file, 'inventories.json') !== false) {
        $data = migrateEventTypes($data);
        $needsPpnuMigration = false;
        foreach ($data as $inventory) {
            if (isset($inventory['inventory_stock']) && is_array($inventory['inventory_stock'])) {
                foreach ($inventory['inventory_stock'] as $product) {
                    if (isset($product['ppnu_ppnv']) && is_array($product['ppnu_ppnv']) && !empty($product['ppnu_ppnv'])) {
                        $needsPpnuMigration = true;
                        break 2;
                    }
                }
            }
        }
        if ($needsPpnuMigration) {
            $data = migratePpnuPpnvToEventHistory($data);
        }
        $data = migrateEventsUserId($data);
        $data = cleanZeroQuantityEvents($data);
        atomicWriteJsonFile($fullPath, $data);
    }

    // --- parcels.json : migrations des champs ---
    if (strpos($file, 'parcels.json') !== false) {
        $migrated = false;
        foreach ($data as &$parcel) {
            // Rename idParcelle → id_parcel
            if (array_key_exists('idParcelle', $parcel) && !array_key_exists('id_parcel', $parcel)) {
                $parcel['id_parcel'] = $parcel['idParcelle'];
                unset($parcel['idParcelle']);
                $migrated = true;
            }
            // Remove place_id
            //if (array_key_exists('place_id', $parcel)) {
                //unset($parcel['place_id']);
                //$migrated = true;
            //}
            // Add sigec_code if missing
            if (!isset($parcel['sigec_code'])) {
                $parcel['sigec_code'] = '';
                $migrated = true;
            }
            // Add parcel_area_unit_fr if missing
            if (!isset($parcel['parcel_area_unit_fr']) || $parcel['parcel_area_unit_fr'] === '') {
                $parcel['parcel_area_unit_fr'] = 'ha';
                $migrated = true;
            }
            // Fix PAC_parcel polygon: unwrap triple-nested coordinates [[[lon,lat],...]] → [[lat,lon],...] (swap to internal lat/lon format)
            if (
                isset($parcel['record_type']) && $parcel['record_type'] === 'PAC_parcel' &&
                isset($parcel['polygone'])
            ) {
                $poly = json_decode($parcel['polygone'], true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($poly) &&
                    count($poly) === 1 && is_array($poly[0]) && isset($poly[0][0]) && is_array($poly[0][0])) {
                    $parcel['polygone'] = json_encode(array_map(function($c) {
                        return [$c[1], $c[0]]; // GeoJSON [lon,lat] → internal [lat,lon]
                    }, $poly[0]), JSON_UNESCAPED_UNICODE);
                    $migrated = true;
                }
            }
            // GML imports: add record_type + remove gml_type_couverture
            if (isset($parcel['imported_from_gml']) && $parcel['imported_from_gml'] === true) {
                if (!isset($parcel['record_type'])) {
                    $parcel['record_type'] = 'gml_import';
                    $migrated = true;
                }
                if (array_key_exists('gml_type_couverture', $parcel)) {
                    unset($parcel['gml_type_couverture']);
                    $migrated = true;
                }
            }
        }
        unset($parcel);
        if ($migrated) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- users_infos.json : migration automatique vers les nouveaux noms de champs ---
    if ($file === 'users_infos.json') {
        $migrated = false;
        foreach ($data as &$entry) {
            if (!is_array($entry)) continue;
            $before = $entry;
            normalizeUserInfoStructure($entry);
            if ($entry !== $before) {
                $migrated = true;
            }
        }
        unset($entry);
        if ($migrated) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- field_works.json : migration automatique vers les nouveaux noms de champs ---
    if (strpos($file, 'field_works.json') !== false) {
        $migrated = false;
        foreach ($data as &$fw) {
            if (!is_array($fw)) continue;
            $before = $fw;
            normalizeFieldWorkStructure($fw);
            if ($fw !== $before) {
                $migrated = true;
            }
        }
        unset($fw);
        if ($migrated) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- crops/crops.json : field renames + is_archived + collection + parcels_id UUID migration ---
    if (strpos($file, 'crops/crops.json') !== false) {
        $migratedCount = migrateCropsWithArchiveFields($data);

        // Migrate parcels_id: replace parcel names with id_parcel UUIDs
        $baseDir = substr($fullPath, 0, strrpos($fullPath, 'crops/crops.json'));
        $parcelsPath = $baseDir . 'exploitation/parcels.json';
        if (file_exists($parcelsPath)) {
            $parcelsContent = file_get_contents($parcelsPath);
            $parcels = json_decode($parcelsContent, true) ?: [];
            // Build name → id_parcel lookup
            $nameToId = [];
            foreach ($parcels as $parcel) {
                if (isset($parcel['parcel_name']) && isset($parcel['id_parcel'])) {
                    $nameToId[$parcel['parcel_name']] = $parcel['id_parcel'];
                }
            }
            $uuidPattern = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';
            foreach ($data as &$crop) {
                if (!isset($crop['parcels_id']) || !is_array($crop['parcels_id'])) {
                    continue;
                }
                $needsMigration = false;
                foreach ($crop['parcels_id'] as $entry) {
                    if (!preg_match($uuidPattern, (string)$entry)) {
                        $needsMigration = true;
                        break;
                    }
                }
                if ($needsMigration) {
                    $crop['parcels_id'] = array_values(array_filter(array_map(
                        function ($entry) use ($nameToId, $uuidPattern) {
                            if (preg_match($uuidPattern, (string)$entry)) {
                                return $entry; // already a UUID
                            }
                            return $nameToId[$entry] ?? null; // null = parcel not found, will be filtered
                        },
                        $crop['parcels_id']
                    )));
                    $migratedCount++;
                }
            }
            unset($crop);
        }

        if ($migratedCount > 0) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- phyto_treatments : consolidation automatique ---
    if (strpos($file, 'phyto_treatments') !== false) {
        $dataModified = false;
        foreach ($data as &$treatment) {
            if (is_array($treatment) && isset($treatment['parcels_concerned'])) {
                if (consolidateAllTreatmentCalculations($treatment)) {
                    $dataModified = true;
                }
            }
        }
        unset($treatment);
        if ($dataModified) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- exploitation/operators.json : renommage des champs ---
    if (strpos($file, 'operators.json') !== false) {
        $fieldMap = [
            'nomEtPrenom'            => 'name',
            'numeroDePhytolicence'   => 'phytolicence',
            'mentionnerEmail'        => 'mail',
            'autorisation'           => 'authorisation',
            'idGestionDesOperations' => 'id_operator',
            'datee'                  => 'date',
        ];
        $migrated = false;
        foreach ($data as &$entry) {
            foreach ($fieldMap as $old => $new) {
                if (array_key_exists($old, $entry) && !array_key_exists($new, $entry)) {
                    $entry[$new] = $entry[$old];
                    unset($entry[$old]);
                    $migrated = true;
                }
            }
        }
        unset($entry);
        if ($migrated) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- exploitation/exploitations.json : renommage des champs ---
    if (strpos($file, 'exploitations.json') !== false) {
        $fieldMap = [
            'adresse'              => 'adress',
            'codePostal'           => 'postal',
            'numeroTVA'            => 'tva',
            'nomDeMonExploitation' => 'name',
            'datee'                => 'date',
        ];
        $migrated = false;
        foreach ($data as &$entry) {
            foreach ($fieldMap as $old => $new) {
                if (array_key_exists($old, $entry) && !array_key_exists($new, $entry)) {
                    $entry[$new] = $entry[$old];
                    unset($entry[$old]);
                    $migrated = true;
                }
            }
        }
        unset($entry);
        if ($migrated) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }

    // --- phyto_treatments_final.json : migration champs + aplatissement + nettoyage ---
    if (strpos($file, 'phyto_treatments_final.json') !== false) {
        // PARTIE 1 : Migration des noms de champs et aplatissement des tableaux
        $migChanged = false;
        $topFieldMap = [
            'event_date'          => 'date',
            'ciblee'              => 'target',
            'remarque'            => 'remark',
            'effectuerNottoyage'  => 'clean_flag',
            'traitementLocal'     => 'localized_treatment',
            'operator_pl'         => 'operator_phytolicence',
            'BaseDecision'        => 'decision_base',
            'Efficacite'          => 'effectiveness',
        ];
        foreach ($data as &$t) {
            foreach ($topFieldMap as $old => $new) {
                if (array_key_exists($old, $t) && !array_key_exists($new, $t)) {
                    $t[$new] = $t[$old];
                    unset($t[$old]);
                    $migChanged = true;
                }
            }
            // Aplatir parcels_concerned [[...]] → [...]
            if (isset($t['parcels_concerned'][0]) &&
                is_array($t['parcels_concerned'][0]) &&
                isset($t['parcels_concerned'][0][0])) {
                $t['parcels_concerned'] = $t['parcels_concerned'][0];
                $migChanged = true;
            }
            // Aplatir treatment_composition [[...]] → [...]
            if (isset($t['treatment_composition'][0]) &&
                is_array($t['treatment_composition'][0]) &&
                isset($t['treatment_composition'][0][0])) {
                $t['treatment_composition'] = $t['treatment_composition'][0];
                $migChanged = true;
            }
            // Migrer root target → chaque composition entry, puis supprimer root target
            if (isset($t['treatment_composition']) && is_array($t['treatment_composition'])) {
                $rootTarget = isset($t['target']) ? $t['target'] : null;
                foreach ($t['treatment_composition'] as &$comp) {
                    if (!is_array($comp)) continue;
                    if ($rootTarget !== null && !array_key_exists('target', $comp)) {
                        $comp['target'] = $rootTarget;
                        $migChanged = true;
                    }
                    if (!array_key_exists('target', $comp)) {
                        $comp['target'] = '';
                        $migChanged = true;
                    }
                }
                unset($comp);
                if (array_key_exists('target', $t)) {
                    unset($t['target']);
                    $migChanged = true;
                }
            }
            // Renommer les champs internes des parcelles concernées
            if (isset($t['parcels_concerned']) && is_array($t['parcels_concerned'])) {
                foreach ($t['parcels_concerned'] as &$p) {
                    if (!is_array($p)) continue;
                    if (array_key_exists('parcels_id', $p) && !array_key_exists('parcel_id', $p)) {
                        $p['parcel_id'] = $p['parcels_id'];
                        unset($p['parcels_id']);
                        $migChanged = true;
                    }
                    if (array_key_exists('parcels_name', $p) && !array_key_exists('parcel_name', $p)) {
                        $p['parcel_name'] = $p['parcels_name'];
                        unset($p['parcels_name']);
                        $migChanged = true;
                    }
                }
                unset($p);
            }
        }
        unset($t);
        if ($migChanged) {
            atomicWriteJsonFile($fullPath, $data);
        }

        // PARTIE 2 : Nettoyage des entrées invalides + valeurs par défaut
        $countBefore = count($data);
        $data = array_values(array_filter($data, function($treatment) {
            $hasEmptyComposition = !isset($treatment['treatment_composition']) ||
                                  empty($treatment['treatment_composition']) ||
                                  (is_array($treatment['treatment_composition']) &&
                                   (count($treatment['treatment_composition']) === 0 ||
                                    (count($treatment['treatment_composition']) === 1 &&
                                     ($treatment['treatment_composition'][0] === null ||
                                      empty($treatment['treatment_composition'][0])))));
            $hasEmptyParcels = !isset($treatment['parcels_concerned']) ||
                              empty($treatment['parcels_concerned']) ||
                              (is_array($treatment['parcels_concerned']) &&
                               count($treatment['parcels_concerned']) === 0);
            return !$hasEmptyComposition && !$hasEmptyParcels;
        }));
        $modified = (count($data) !== $countBefore);
        foreach ($data as &$treatment) {
            if (!array_key_exists('decision_base', $treatment)) {
                $treatment['decision_base'] = 'Non définit';
                $modified = true;
            }
            if (!array_key_exists('effectiveness', $treatment)) {
                $treatment['effectiveness'] = "Pas d'avis";
                $modified = true;
            }
        }
        unset($treatment);
        if ($modified) {
            atomicWriteJsonFile($fullPath, $data);
        }
    }
}
?>
