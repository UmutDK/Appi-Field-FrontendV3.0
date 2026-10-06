<?php
/**
 * Gestionnaire centralisé pour les traitements phytosanitaires
 * VERSION SIMPLIFIÉE - Gestion uniquement de phyto_treatments_final.json
 * Plus de fichiers tampons (phyto_treatments.json, events_parcels.json)
 */

require_once 'auth_utils.php';
require_once 'treatment_utils.php';
require_once 'inventory_utils.php';
require_once 'file_utils.php';
require_once 'response_utils.php';
require_once 'validation_utils.php';

/**
 * Valide la structure d'un traitement complet avant sauvegarde
 */
function validateTreatmentStructure($treatment) {
    $requiredFields = [
        'event_id',
        'date',
        'type',
        'id_user',
        'parcels_concerned',
        'treatment_composition'
    ];
    
    $missing = [];
    foreach ($requiredFields as $field) {
        if (!isset($treatment[$field]) || (is_array($treatment[$field]) && empty($treatment[$field]))) {
            $missing[] = $field;
        }
    }
    
    if (!empty($missing)) {
        return [
            'valid' => false,
            'error' => 'Champs obligatoires manquants: ' . implode(', ', $missing)
        ];
    }
    
    // Valider parcels_concerned
    if (!is_array($treatment['parcels_concerned']) ||
        empty($treatment['parcels_concerned'])) {
        return [
            'valid' => false,
            'error' => 'Au moins une parcelle doit être sélectionnée'
        ];
    }

    // Valider treatment_composition
    if (!is_array($treatment['treatment_composition']) ||
        empty($treatment['treatment_composition'])) {
        return [
            'valid' => false,
            'error' => 'Au moins un produit doit être ajouté à la composition'
        ];
    }
    
    return ['valid' => true];
}

/**
 * Crée un nouveau traitement (POST)
 */
function createTreatment($treatmentData, $userId, $baseDir) {
    // Les données sont déjà décodées depuis index.php
    $newTreatment = $treatmentData;
    
    if (!is_array($newTreatment)) {
        sendBadRequestResponse('Données de traitement invalides');
    }
    
    // Ajouter l'ID utilisateur si pas présent
    if (!isset($newTreatment['id_user'])) {
        $newTreatment['id_user'] = $userId;
    }
    
    // Vérifier que le traitement appartient bien à l'utilisateur connecté
    if ($newTreatment['id_user'] !== $userId) {
        sendUnauthorizedResponse('Vous ne pouvez pas créer un traitement pour un autre utilisateur');
    }
    
    // Normaliser d'abord (event_date → date, ciblee → target, etc.) AVANT validation
    normalizePhytoTreatmentStructure($newTreatment);

    // Valider la structure
    $validation = validateTreatmentStructure($newTreatment);
    if (!$validation['valid']) {
        sendBadRequestResponse($validation['error']);
    }
    
    // Consolider les calculs (vérification serveur)
    consolidateAllTreatmentCalculations($newTreatment);
    
    // Lire le fichier final
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';
    $treatments = readJsonFile($finalPath);
    
    if ($treatments === null) {
        $treatments = [];
    }
    
    // Vérifier les doublons par event_id
    $eventId = $newTreatment['event_id'];
    $duplicate = false;
    foreach ($treatments as $existing) {
        if (isset($existing['event_id']) && $existing['event_id'] === $eventId) {
            $duplicate = true;
            break;
        }
    }
    
    if ($duplicate) {
        sendBadRequestResponse('Un traitement avec cet event_id existe déjà. Utilisez PUT pour le modifier.');
    }
    
    // Ajouter le traitement
    $treatments[] = $newTreatment;
    
    // Sauvegarder
    atomicWriteJsonFile($finalPath, $treatments);
    
    // Mettre à jour l'inventaire
    updateInventoryForModifiedTreatmentsDirect($treatments, [$eventId], $userId, $baseDir);
    
    sendSuccessResponse('Traitement créé avec succès', [
        'event_id' => $eventId,
        'treatment' => $newTreatment
    ]);
}

/**
 * Modifie un traitement existant (PUT)
 */
function updateTreatment($eventId, $treatmentData, $userId, $baseDir) {
    // Les données sont déjà décodées depuis index.php
    $updatedTreatment = $treatmentData;
    
    if (!is_array($updatedTreatment)) {
        sendBadRequestResponse('Données de traitement invalides');
    }
    
    // Normaliser d'abord (event_date → date, ciblee → target, etc.) AVANT validation
    normalizePhytoTreatmentStructure($updatedTreatment);

    // Valider la structure
    $validation = validateTreatmentStructure($updatedTreatment);
    if (!$validation['valid']) {
        sendBadRequestResponse($validation['error']);
    }
    
    // L'eventId est passé en paramètre, pas besoin de le récupérer du traitement
    // Mais on s'assure qu'il est cohérent
    if (!isset($updatedTreatment['event_id'])) {
        $updatedTreatment['event_id'] = $eventId;
    } elseif ($updatedTreatment['event_id'] !== $eventId) {
        sendBadRequestResponse('event_id incohérent entre paramètre et données');
    }
    
    // Consolider les calculs (vérification serveur)
    consolidateAllTreatmentCalculations($updatedTreatment);
    
    // Lire le fichier final
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';
    $treatments = readJsonFile($finalPath);
    
    if ($treatments === null || !is_array($treatments)) {
        sendNotFoundResponse('Fichier de traitements non trouvé');
    }
    
    // Trouver et remplacer le traitement
    $found = false;
    foreach ($treatments as &$treatment) {
        if (isset($treatment['event_id']) && $treatment['event_id'] === $eventId) {
            // Vérifier que le traitement appartient à l'utilisateur
            if (isset($treatment['id_user']) && $treatment['id_user'] !== $userId) {
                sendUnauthorizedResponse('Vous ne pouvez pas modifier le traitement d\'un autre utilisateur');
            }
            
            $treatment = $updatedTreatment;
            $found = true;
            break;
        }
    }
    
    if (!$found) {
        sendNotFoundResponse('Traitement non trouvé avec event_id: ' . $eventId);
    }
    
    // Sauvegarder
    atomicWriteJsonFile($finalPath, $treatments);
    
    // Mettre à jour l'inventaire
    updateInventoryForModifiedTreatmentsDirect($treatments, [$eventId], $userId, $baseDir);
    
    sendSuccessResponse('Traitement modifié avec succès', [
        'event_id' => $eventId,
        'treatment' => $updatedTreatment
    ]);
}

/**
 * Supprime un traitement (DELETE)
 */
function deleteTreatment($eventId, $userId, $baseDir) {
    if (empty($eventId)) {
        sendBadRequestResponse('event_id manquant');
    }
    
    // Lire le fichier final
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';
    $treatments = readJsonFile($finalPath);
    
    if ($treatments === null || !is_array($treatments)) {
        sendNotFoundResponse('Fichier de traitements non trouvé');
    }
    
    // Trouver et supprimer le traitement
    $found = false;
    $filteredTreatments = [];
    
    foreach ($treatments as $treatment) {
        if (isset($treatment['event_id']) && $treatment['event_id'] === $eventId) {
            // Vérifier que le traitement appartient à l'utilisateur
            if (isset($treatment['id_user']) && $treatment['id_user'] !== $userId) {
                sendUnauthorizedResponse('Vous ne pouvez pas supprimer le traitement d\'un autre utilisateur');
            }
            $found = true;
            // Ne pas ajouter à filteredTreatments (= suppression)
        } else {
            $filteredTreatments[] = $treatment;
        }
    }
    
    if (!$found) {
        sendNotFoundResponse('Traitement non trouvé avec event_id: ' . $eventId);
    }
    
    // Sauvegarder
    atomicWriteJsonFile($finalPath, $filteredTreatments);
    
    // Mettre à jour l'inventaire (supprimer les entrées correspondantes)
    syncInventoryAfterTreatmentDeletion($eventId, $userId);
    
    sendSuccessResponse('Traitement supprimé avec succès', ['event_id' => $eventId]);
}

/**
 * Récupère tous les traitements de l'utilisateur (GET)
 */
function getTreatments($baseDir, $userId) {
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';
    $treatments = readJsonFile($finalPath);
    
    if ($treatments === null) {
        sendJsonResponse([], 200);
    }
    
    // Filtrer par utilisateur
    $userTreatments = array_filter($treatments, function($treatment) use ($userId) {
        return isset($treatment['id_user']) && $treatment['id_user'] === $userId;
    });
    
    sendJsonResponse(array_values($userTreatments), 200);
}

/**
 * Récupère un traitement spécifique par event_id (GET)
 */
function getTreatmentById($baseDir, $userId, $eventId) {
    if (empty($eventId)) {
        sendBadRequestResponse('event_id manquant');
    }
    
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';
    $treatments = readJsonFile($finalPath);
    
    if ($treatments === null) {
        sendNotFoundResponse('Fichier de traitements non trouvé');
    }
    
    // Chercher le traitement
    foreach ($treatments as $treatment) {
        if (isset($treatment['event_id']) && $treatment['event_id'] === $eventId) {
            // Vérifier que le traitement appartient à l'utilisateur
            if (isset($treatment['id_user']) && $treatment['id_user'] !== $userId) {
                sendUnauthorizedResponse('Accès interdit à ce traitement');
            }
            
            sendJsonResponse($treatment, 200);
        }
    }
    
    sendNotFoundResponse('Traitement non trouvé avec event_id: ' . $eventId);
}

// ============================================================================
// ROUTAGE HTTP
// ============================================================================

/**
 * Dispatch les routes HTTP liées aux traitements phytosanitaires.
 * Appelle exit() si une route est traitée, sinon retourne sans rien faire.
 */
function handlePhytoTreatmentRoutes($method, $file, $fullPath, $baseDir, $userId = null, $effectiveUserId = null) {
    $action = $_GET['action'] ?? null;

    // GET: Consolidation forcée des surfaces
    if ($method === 'GET' && isset($_GET['consolidate_surfaces']) && $_GET['consolidate_surfaces'] === 'true') {
        if (strpos($file, 'phyto_treatments') !== false && is_file($fullPath)) {
            $authUserId = authenticateAndGetUserId();
            if (!$authUserId) {
                sendUnauthorizedResponse('Token d\'authentification invalide ou manquant pour la consolidation');
            }
            $data = readJsonFile($fullPath);
            if ($data !== null && is_array($data)) {
                $consolidatedCount = 0;
                $details = [];
                foreach ($data as &$treatment) {
                    if (is_array($treatment) && isset($treatment['id_user']) && $treatment['id_user'] == $authUserId) {
                        if (consolidateAllTreatmentCalculations($treatment)) {
                            $consolidatedCount++;
                            $details[] = [
                                'event_id' => $treatment['event_id'] ?? 'N/A',
                                'standard_total_surface_treated' => $treatment['standard_total_surface_treated'] ?? 0,
                                'treatment_total_quantity_used' => $treatment['treatment_total_quantity_used'] ?? 0,
                                'consolidated_at' => $treatment['calculations_consolidated_at'] ?? 'N/A'
                            ];
                        }
                    }
                }
                if ($consolidatedCount > 0) {
                    atomicWriteJsonFile($fullPath, $data);
                }
                sendSuccessResponse(
                    "Consolidation complète terminée: $consolidatedCount traitement(s) mis à jour",
                    ['consolidated_count' => $consolidatedCount, 'details' => $details]
                );
            }
        }
        return;
    }

    // POST: Création d'un traitement complet
    if ($method === 'POST' && strpos($file, 'phyto_treatments_final.json') !== false) {
        $input = file_get_contents('php://input');
        $treatmentData = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'JSON invalide']);
            exit;
        }
        $result = createTreatment($treatmentData, $effectiveUserId ?? $userId, $baseDir);
        http_response_code($result['success'] ? 201 : 400);
        echo json_encode($result);
        exit;
    }

    // DELETE: Suppression d'un traitement par event_id
    if ($method === 'DELETE' && strpos($file, 'phyto_treatments_final.json') !== false && isset($_GET['event_id'])) {
        $eventId = $_GET['event_id'];
        $result = deleteTreatment($eventId, $effectiveUserId, $baseDir);
        http_response_code($result['success'] ? 200 : ($result['code'] ?? 404));
        echo json_encode($result);
        exit;
    }

    // PUT: Modification d'un traitement par event_id
    if ($method === 'PUT' && strpos($file, 'phyto_treatments_final.json') !== false && isset($_GET['event_id'])) {
        $input = file_get_contents('php://input');
        $treatmentData = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'JSON invalide']);
            exit;
        }
        $eventId = $_GET['event_id'];
        $result = updateTreatment($eventId, $treatmentData, $effectiveUserId, $baseDir);
        http_response_code($result['success'] ? 200 : ($result['code'] ?? 400));
        echo json_encode($result);
        exit;
    }

    // PUT: Nettoyer les doublons
    if ($method === 'PUT' && $action === 'clean_duplicate_treatments') {
        $finalPath = $baseDir . 'events/phyto_treatments_final.json';
        if (!is_file($finalPath)) {
            http_response_code(404);
            echo json_encode(['error' => 'Fichier phyto_treatments_final.json non trouvé.']);
            exit;
        }
        $content = file_get_contents($finalPath);
        $treatments = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Fichier JSON invalide.']);
            exit;
        }
        $originalCount = count($treatments);
        cleanDuplicateAndHybridTreatments($treatments);
        $cleanedCount = count($treatments);
        file_put_contents($finalPath, json_encode($treatments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode([
            'success' => true,
            'message' => "Nettoyage terminé: passé de $originalCount à $cleanedCount traitement(s)",
            'original_count' => $originalCount,
            'cleaned_count' => $cleanedCount,
            'removed_count' => $originalCount - $cleanedCount
        ]);
        exit;
    }

    // PUT: Normaliser les traitements phyto
    if ($method === 'PUT' && $action === 'normalize_phyto_treatments') {
        $finalPath = $baseDir . 'events/phyto_treatments_final.json';
        if (!is_file($finalPath)) {
            http_response_code(404);
            echo json_encode(['error' => 'Fichier phyto_treatments_final.json non trouvé']);
            exit;
        }
        $content = file_get_contents($finalPath);
        $treatments = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            http_response_code(400);
            echo json_encode(['error' => 'Erreur lors du décodage JSON']);
            exit;
        }
        if (!is_array($treatments)) {
            $treatments = [];
        }
        $normalizedCount = 0;
        $recalculatedCount = 0;
        foreach ($treatments as &$treatment) {
            if (isset($treatment['event_id'])) {
                consolidateAllTreatmentCalculations($treatment);
                $recalculatedCount++;
            }
        }
        file_put_contents($finalPath, json_encode($treatments, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo json_encode([
            'success' => true,
            'message' => "Normalisation terminée",
            'total_treatments' => count($treatments),
            'normalized_count' => $normalizedCount,
            'recalculated_count' => $recalculatedCount
        ]);
        exit;
    }

    // PUT: Transfert étape 3 → 4
    if ($method === 'PUT') {
        $input = file_get_contents('php://input');
        $inputData = json_decode($input, true) ?: [];
        if ($action === 'step3_to_step4_transfer' ||
            (isset($inputData['action']) && $inputData['action'] === 'step3_to_step4_transfer')) {
            handlePhytoStep3Transfer($baseDir, $userId, $effectiveUserId);
        }
    }
}

/**
 * Gère le transfert complet étape 3 → étape 4.
 * Toujours appelle exit() en fin de traitement.
 */
function handlePhytoStep3Transfer($baseDir, $userId, $effectiveUserId) {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true) ?: [];

    $isModification = (isset($_GET['modification_mode']) && $_GET['modification_mode'] === 'true') ||
                    (isset($data['modification_mode']) && $data['modification_mode'] === true);
    $originalEventId = $_GET['original_event_id'] ?? $data['original_event_id'] ?? null;

    $cachedMetadata = $data['cached_metadata'] ?? null;

    $preservedMetadata = [];
    $metadataEntry = null;
    $componentEntries = [];

    $phytoTreatmentsPath = $baseDir . 'events/phyto_treatments.json';
    $eventsParcelsPath = $baseDir . 'events/events_parcels.json';
    $finalPath = $baseDir . 'events/phyto_treatments_final.json';

    $userPhytoData = [];
    $userParcelsData = [];

    if (is_file($phytoTreatmentsPath)) {
        $phytoContent = file_get_contents($phytoTreatmentsPath);
    }
    if (is_file($eventsParcelsPath)) {
        $parcelsContent = file_get_contents($eventsParcelsPath);
    }

    if (is_file($phytoTreatmentsPath)) {
        $content = file_get_contents($phytoTreatmentsPath);
        $allPhytoData = json_decode($content, true) ?: [];

        foreach ($allPhytoData as $treatment) {
            if (isset($treatment['id_user']) && $treatment['id_user'] === $userId) {
                if (isset($treatment['is_metadata_only']) && $treatment['is_metadata_only'] === true) {
                    $metadataEntry = $treatment;
                } else {
                    $componentEntries[] = $treatment;
                }
            }
        }

        $userPhytoData = $componentEntries;

        if ($cachedMetadata) {
            $preservedMetadata = [
                'type'                        => $cachedMetadata['type'] ?? '',
                'operator_id'                 => $cachedMetadata['operator_id'] ?? '',
                'operator_name'               => $cachedMetadata['operator_name'] ?? '',
                'operator_phytolicence'       => $cachedMetadata['operator_phytolicence'] ?? $cachedMetadata['operator_pl'] ?? '',
                'target'                      => $cachedMetadata['target'] ?? $cachedMetadata['ciblee'] ?? '',
                'remark'                      => $cachedMetadata['remark'] ?? $cachedMetadata['remarque'] ?? '',
                'bbch'                        => $cachedMetadata['bbch'] ?? '',
                'event_hour'                  => $cachedMetadata['event_hour'] ?? '',
                'date'                        => $cachedMetadata['date'] ?? $cachedMetadata['event_date'] ?? '',
                'harvest_date'                => $cachedMetadata['harvest_date'] ?? '',
                'clean_flag'                  => $cachedMetadata['clean_flag'] ?? $cachedMetadata['effectuerNottoyage'] ?? '',
                'localized_treatment'         => $cachedMetadata['localized_treatment'] ?? $cachedMetadata['traitementLocal'] ?? '',
                'treatment_total_quantity'    => $cachedMetadata['treatment_total_quantity'] ?? '',
                'treatment_total_quantity_used' => $cachedMetadata['treatment_total_quantity_used'] ?? ''
            ];
        } elseif ($metadataEntry) {
            $preservedMetadata = [
                'type'                        => $metadataEntry['type'] ?? '',
                'operator_id'                 => $metadataEntry['operator_id'] ?? '',
                'operator_name'               => $metadataEntry['operator_name'] ?? '',
                'operator_phytolicence'       => $metadataEntry['operator_phytolicence'] ?? $metadataEntry['operator_pl'] ?? '',
                'target'                      => $metadataEntry['target'] ?? $metadataEntry['ciblee'] ?? '',
                'remark'                      => $metadataEntry['remark'] ?? $metadataEntry['remarque'] ?? '',
                'bbch'                        => $metadataEntry['bbch'] ?? '',
                'event_hour'                  => $metadataEntry['event_hour'] ?? '',
                'date'                        => $metadataEntry['date'] ?? $metadataEntry['event_date'] ?? '',
                'harvest_date'                => $metadataEntry['harvest_date'] ?? '',
                'clean_flag'                  => $metadataEntry['clean_flag'] ?? $metadataEntry['effectuerNottoyage'] ?? '',
                'localized_treatment'         => $metadataEntry['localized_treatment'] ?? $metadataEntry['traitementLocal'] ?? '',
                'treatment_total_quantity'    => $metadataEntry['treatment_total_quantity'] ?? '',
                'treatment_total_quantity_used' => $metadataEntry['treatment_total_quantity_used'] ?? ''
            ];
        } else {
            $firstComponent = $userPhytoData[0] ?? null;
            if ($firstComponent) {
                $preservedMetadata = [
                    'type'                        => $firstComponent['type'] ?? '',
                    'operator_id'                 => $firstComponent['operator_id'] ?? '',
                    'operator_name'               => $firstComponent['operator_name'] ?? '',
                    'operator_phytolicence'       => $firstComponent['operator_phytolicence'] ?? $firstComponent['operator_pl'] ?? '',
                    'target'                      => $firstComponent['target'] ?? $firstComponent['ciblee'] ?? '',
                    'remark'                      => $firstComponent['remark'] ?? $firstComponent['remarque'] ?? '',
                    'bbch'                        => $firstComponent['bbch'] ?? '',
                    'event_hour'                  => $firstComponent['event_hour'] ?? '',
                    'date'                        => $firstComponent['date'] ?? $firstComponent['event_date'] ?? '',
                    'harvest_date'                => $firstComponent['harvest_date'] ?? '',
                    'clean_flag'                  => $firstComponent['clean_flag'] ?? $firstComponent['effectuerNottoyage'] ?? '',
                    'localized_treatment'         => $firstComponent['localized_treatment'] ?? $firstComponent['traitementLocal'] ?? '',
                    'treatment_total_quantity'    => $firstComponent['treatment_total_quantity'] ?? '',
                    'treatment_total_quantity_used' => $firstComponent['treatment_total_quantity_used'] ?? ''
                ];
            }
        }
    }

    if (is_file($eventsParcelsPath)) {
        $content = file_get_contents($eventsParcelsPath);
        $allParcelsData = json_decode($content, true) ?: [];
        foreach ($allParcelsData as $parcel) {
            if (isset($parcel['id_user']) && $parcel['id_user'] === $userId) {
                $userParcelsData[] = $parcel;
            }
        }
    }

    if ($isModification && empty($userPhytoData) && empty($userParcelsData)) {
        if (isset($data['treatment_composition']) && is_array($data['treatment_composition'])) {
            foreach ($data['treatment_composition'] as $compGroup) {
                if (is_array($compGroup) && isset($compGroup['component_id'])) {
                    // flat structure: each element is a component
                    $compGroup['id_user'] = $userId;
                    $userPhytoData[] = $compGroup;
                } elseif (is_array($compGroup)) {
                    // legacy double-wrapped structure
                    foreach ($compGroup as $component) {
                        if (isset($component['component_id'])) {
                            $component['id_user'] = $userId;
                            $userPhytoData[] = $component;
                        }
                    }
                }
            }
        }

        if (isset($data['parcels_concerned']) && is_array($data['parcels_concerned'])) {
            foreach ($data['parcels_concerned'] as $parcelGroup) {
                if (is_array($parcelGroup) && (isset($parcelGroup['parcel_id']) || isset($parcelGroup['parcels_id']))) {
                    // flat structure: each element is a parcel
                    $parcelGroup['id_user'] = $userId;
                    $userParcelsData[] = $parcelGroup;
                } elseif (is_array($parcelGroup)) {
                    // legacy double-wrapped structure
                    foreach ($parcelGroup as $parcel) {
                        if (isset($parcel['parcel_id']) || isset($parcel['parcels_id'])) {
                            $parcel['id_user'] = $userId;
                            $userParcelsData[] = $parcel;
                        }
                    }
                }
            }
        }

        if (empty($userPhytoData) && isset($data['components']) && is_array($data['components'])) {
            foreach ($data['components'] as $component) {
                if (isset($component['component_id'])) {
                    $component['id_user'] = $userId;
                    $userPhytoData[] = $component;
                }
            }
        }

        if (empty($userParcelsData) && isset($data['parcels']) && is_array($data['parcels'])) {
            foreach ($data['parcels'] as $parcel) {
                if (isset($parcel['parcel_id']) || isset($parcel['parcels_id'])) {
                    $parcel['id_user'] = $userId;
                    $userParcelsData[] = $parcel;
                }
            }
        }
    }

    if (empty($userPhytoData) && empty($userParcelsData)) {
        http_response_code(400);
        $availableEntries = [];
        if (is_file($phytoTreatmentsPath)) {
            $content = file_get_contents($phytoTreatmentsPath);
            $allData = json_decode($content, true) ?: [];
            foreach ($allData as $entry) {
                if (isset($entry['id_user'])) {
                    $availableEntries[] = substr($entry['id_user'], 0, 12);
                }
            }
        }
        echo json_encode([
            'error' => "id_user $userId non trouvé.",
            'debug' => 'Vérifiez que l\'entrée existe dans le fichier.',
            'available_entries' => array_unique($availableEntries),
            'searched_user_id' => $userId,
            'file_paths_checked' => [$phytoTreatmentsPath, $eventsParcelsPath]
        ]);
        exit;
    }

    if ($isModification && $originalEventId) {
        $transferEventId = $originalEventId;
    } else {
        $transferEventId = 'transfer_' . substr($userId, 0, 8) . '_' . time();
    }

    $finalTreatment = [
        'event_id' => $transferEventId,
        'id_user' => $userId,
        'created_at' => date('Y-m-d\TH:i:sP'),
        'transferred_at' => date('Y-m-d\TH:i:sP'),
        'user_transfer' => true,
        'modification_mode' => $isModification
    ];

    foreach ($preservedMetadata as $key => $value) {
        if ($key !== 'workflow_step' && $key !== 'mode') {
            $finalTreatment[$key] = $value;
        }
    }

    if (!array_key_exists('type', $finalTreatment)) {
        $finalTreatment['type'] = 'phyto_surface_treatment';
    }
    if (!array_key_exists('date', $finalTreatment)) {
        $finalTreatment['date'] = date('Y-m-d');
    }
    if (!array_key_exists('event_hour', $finalTreatment)) {
        $finalTreatment['event_hour'] = date('H:i');
    }
    if (!array_key_exists('target', $finalTreatment)) {
        $finalTreatment['target'] = '';
    }
    if (!array_key_exists('remark', $finalTreatment)) {
        $finalTreatment['remark'] = '';
    }
    if (!array_key_exists('operator_id', $finalTreatment)) {
        $finalTreatment['operator_id'] = '';
    }
    if (!array_key_exists('operator_name', $finalTreatment)) {
        $finalTreatment['operator_name'] = '';
    }
    if (!array_key_exists('operator_phytolicence', $finalTreatment)) {
        $finalTreatment['operator_phytolicence'] = '';
    }

    $treatmentComposition = [];
    $componentsList = [];
    foreach ($userPhytoData as $treatment) {
        if (isset($treatment['component_id'])) {
            $componentsList[] = [
                'component_id' => $treatment['component_id'],
                'component_name' => $treatment['component_name'] ?? '',
                'component_numaut' => $treatment['component_numaut'] ?? '',
                'component_type' => $treatment['component_type'] ?? '',
                'component_dose' => $treatment['component_dose'] ?? 0,
                'component_dose_unit' => $treatment['component_dose_unit'] ?? '',
                'standard_component_dose' => $treatment['standard_component_dose'] ?? 0,
                'component_quantity' => $treatment['component_quantity'] ?? null,
                'component_quantity_unity' => $treatment['component_quantity_unity'] ?? ''
            ];
        }
    }
    if (!empty($componentsList)) {
        $finalTreatment['treatment_composition'] = $componentsList;
    } else {
        $finalTreatment['treatment_composition'] = [null];
    }

    if (!empty($userParcelsData)) {
        $cleanedParcelsData = [];
        foreach ($userParcelsData as $parcel) {
            $cleanedParcelsData[] = [
                'parcel_id' => $parcel['parcel_id'] ?? $parcel['parcels_id'] ?? 0,
                'parcel_name' => $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? '',
                'parcel_surface' => $parcel['surface_totale'] ?? 0,
                'parcel_surface_treated' => $parcel['parcel_surface_treated'] ?? 0,
                'surface_unit' => $parcel['surface_unit'] ?? 'ha',
                'standard_surface_treated' => $parcel['standard_surface_treated'] ?? 0,
                'crop_id' => $parcel['crop_id'] ?? '',
                'crop_name' => $parcel['crop_name'] ?? '',
                'phytoweb_name' => $parcel['phytoweb_name'] ?? $parcel['nomPhytoweb_crops_id'] ?? '',
                'eppo' => $parcel['eppo'] ?? $parcel['EPPOCode'] ?? '',
                'treatment_volume_applied' => $parcel['treatment_volume_applied'] ?? 0
            ];
        }
        $finalTreatment['parcels_concerned'] = $cleanedParcelsData;
    }

    foreach ($preservedMetadata as $key => $value) {
        if ($value !== '' && $value !== null) {
            $finalTreatment[$key] = $value;
        }
    }

    consolidateAllTreatmentCalculations($finalTreatment);

    foreach ($preservedMetadata as $key => $value) {
        if ($value !== '' && $value !== null) {
            $finalTreatment[$key] = $value;
        }
    }

    $treatmentType = $finalTreatment['type'] ?? '';
    $isBouillieMode = (strpos($treatmentType, 'bouillie') !== false) ||
                      (strpos($treatmentType, 'porridge') !== false);
    if ($isBouillieMode && isset($preservedMetadata['treatment_total_quantity_used']) &&
        !empty($preservedMetadata['treatment_total_quantity_used'])) {
        $finalTreatment['treatment_total_quantity_used'] = $preservedMetadata['treatment_total_quantity_used'];
    }

    $finalData = [];
    if (is_file($finalPath)) {
        $content = file_get_contents($finalPath);
        $finalData = json_decode($content, true) ?: [];
    }

    if ($isModification && $originalEventId) {
        $entryReplaced = false;
        for ($i = 0; $i < count($finalData); $i++) {
            if (isset($finalData[$i]['event_id']) && $finalData[$i]['event_id'] === $originalEventId) {
                $existingTreatment = $finalData[$i];

                if (isset($existingTreatment['created_at'])) {
                    $finalTreatment['created_at'] = $existingTreatment['created_at'];
                }

                $operatorFields = ['operator_id', 'operator_name', 'operator_phytolicence', 'target', 'remark', 'bbch',
                                 'clean_flag', 'localized_treatment', 'event_hour', 'date'];

                foreach ($operatorFields as $field) {
                    if (isset($finalTreatment[$field]) && $finalTreatment[$field] !== '' && $finalTreatment[$field] !== null) {
                        // Conserver la nouvelle valeur (déjà en place)
                    } else {
                        if (isset($existingTreatment[$field]) && $existingTreatment[$field] !== '' && $existingTreatment[$field] !== null) {
                            $finalTreatment[$field] = $existingTreatment[$field];
                        }
                    }
                }

                if (isset($existingTreatment['parcels_concerned']) && isset($finalTreatment['parcels_concerned'])) {
                    $existingParcels = $existingTreatment['parcels_concerned'];
                    $newParcels = $finalTreatment['parcels_concerned'];
                    $mergedParcels = [];
                    foreach ($newParcels as $newParcel) {
                        $parcelId = $newParcel['parcel_id'] ?? $newParcel['parcels_id'] ?? null;
                        $existingParcel = null;
                        foreach ($existingParcels as $existing) {
                            if (($existing['parcel_id'] ?? $existing['parcels_id'] ?? null) === $parcelId) {
                                $existingParcel = $existing;
                                break;
                            }
                        }
                        if ($existingParcel) {
                            $mergedParcels[] = array_merge($newParcel, [
                                'parcel_surface_treated' => $existingParcel['parcel_surface_treated'] ?? $newParcel['parcel_surface_treated'],
                                'standard_surface_treated' => $existingParcel['standard_surface_treated'] ?? $newParcel['standard_surface_treated'],
                                'treatment_volume_applied' => $existingParcel['treatment_volume_applied'] ?? $newParcel['treatment_volume_applied'],
                            ]);
                        } else {
                            $mergedParcels[] = $newParcel;
                        }
                    }
                    $finalTreatment['parcels_concerned'] = $mergedParcels;
                }

                if (isset($existingTreatment['standard_total_surface_treated'])) {
                    $finalTreatment['standard_total_surface_treated'] = $existingTreatment['standard_total_surface_treated'];
                }
                if (isset($existingTreatment['treatment_total_quantity_used'])) {
                    $finalTreatment['treatment_total_quantity_used'] = $existingTreatment['treatment_total_quantity_used'];
                }

                $finalData[$i] = $finalTreatment;
                $entryReplaced = true;

                consolidateAllTreatmentCalculations($finalData[$i]);

                foreach ($operatorFields as $field) {
                    if (isset($finalTreatment[$field]) && $finalTreatment[$field] !== '' && $finalTreatment[$field] !== null) {
                        $finalData[$i][$field] = $finalTreatment[$field];
                    }
                }

                break;
            }
        }

        if (!$entryReplaced) {
            $finalData[] = $finalTreatment;
        }
    } else {
        $finalData[] = $finalTreatment;
    }

    file_put_contents($finalPath, json_encode($finalData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    if (!empty($userPhytoData)) {
        $content = file_get_contents($phytoTreatmentsPath);
        $allPhytoData = json_decode($content, true) ?: [];
        $filteredPhytoData = array_filter($allPhytoData, function($treatment) use ($userId) {
            return !isset($treatment['id_user']) || $treatment['id_user'] !== $userId;
        });
        $filteredPhytoData = array_values($filteredPhytoData);
        file_put_contents($phytoTreatmentsPath, json_encode($filteredPhytoData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    if (!empty($userParcelsData)) {
        $content = file_get_contents($eventsParcelsPath);
        $allParcelsData = json_decode($content, true) ?: [];
        $filteredParcelsData = array_filter($allParcelsData, function($parcel) use ($userId) {
            return !isset($parcel['id_user']) || $parcel['id_user'] !== $userId;
        });
        $filteredParcelsData = array_values($filteredParcelsData);
        file_put_contents($eventsParcelsPath, json_encode($filteredParcelsData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }

    if (is_file($phytoTreatmentsPath)) {
        file_put_contents($phytoTreatmentsPath, json_encode([], JSON_PRETTY_PRINT));
    }
    if (is_file($eventsParcelsPath)) {
        file_put_contents($eventsParcelsPath, json_encode([], JSON_PRETTY_PRINT));
    }

    echo json_encode([
        'success' => true,
        'message' => 'Transfert utilisateur réussi. Traitement prêt pour répartition.',
        'event_id' => $transferEventId,
        'user_id' => $userId,
        'transferred_data' => [
            'phyto_treatments' => count($userPhytoData),
            'parcels' => count($userParcelsData),
            'metadata_separated' => $metadataEntry !== null,
            'components_count' => count($componentEntries)
        ],
        'final_treatment' => $finalTreatment,
        'temp_files_cleaned' => true,
        'next_step' => 'step4_repartition'
    ]);
    exit;
}
?>
