<?php
/**
 * Fonctions utilitaires pour la gestion d'inventaire
 * Synchronisation, migration, calculs de stock, gestion PPNU/PPNV
 */

function removeInventoryEntriesByEventId($inventories, $eventId, $userId = null) {
    if (!is_array($inventories) || empty($eventId)) {
        return $inventories;
    }
    $totalRemoved = 0;
    foreach ($inventories as &$inventory) {
        // Filtrer par id_user si fourni
        if ($userId !== null && (!isset($inventory['id_user']) || $inventory['id_user'] !== $userId)) {
            continue;
        }
        if (!isset($inventory['event_history']) || !is_array($inventory['event_history'])) {
            continue;
        }
        $originalCount = count($inventory['event_history']);
        $inventory['event_history'] = array_filter(
            $inventory['event_history'],
            function($event) use ($eventId) {
                return $event['event_id'] !== $eventId;
            }
        );
        $inventory['event_history'] = array_values($inventory['event_history']);
        $removedCount = $originalCount - count($inventory['event_history']);
        $totalRemoved += $removedCount;
    }
    if ($totalRemoved > 0) {
        foreach ($inventories as &$inventory) {
            if ($userId !== null && (!isset($inventory['id_user']) || $inventory['id_user'] !== $userId)) {
                continue;
            }
            if (isset($inventory['event_history']) && is_array($inventory['event_history'])) {
                $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
            }
        }
    }
    return $inventories;
}

function syncInventoryAfterTreatmentDeletion($eventId, $userId = null) {
    global $baseDir;
    
    $inventoryPath = $baseDir . 'exploitation/inventories.json';
    
    if (!is_file($inventoryPath)) {
        return false;
    }
    
    $inventoryContent = file_get_contents($inventoryPath);
    $inventories = json_decode($inventoryContent, true);
    
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($inventories)) {
        return false;
    }
    
    // Supprimer les entrées correspondantes uniquement pour l'utilisateur
    $updatedInventories = removeInventoryEntriesByEventId($inventories, $eventId, $userId);
    
    // Sauvegarder
    file_put_contents($inventoryPath, json_encode($updatedInventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        
    return true;
}

function updateInventoryForModifiedTreatmentsDirect($treatments, $affectedTreatmentIds, $userId = null, $baseDir = null) {
    if (!$baseDir) {
        $baseDir = __DIR__ . '/';
    }
    
    $inventoryPath = $baseDir . 'exploitation/inventories.json';
    
    if (!file_exists($inventoryPath)) {
        return false;
    }
    
    // Lire le fichier inventaire
    $inventoryData = file_get_contents($inventoryPath);
    if ($inventoryData === false) {
        return false;
    }
    
    $inventories = json_decode($inventoryData, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return false;
    }
    
    // Vérification de cohérence : supprimer les événements "treatment" orphelins
    // (dont l'event_id n'existe plus dans phyto_treatments_final.json)
    $treatmentsPath = $baseDir . 'events/phyto_treatments_final.json';
    $validEventIds = [];
    
    if (file_exists($treatmentsPath)) {
        $treatmentsData = file_get_contents($treatmentsPath);
        if ($treatmentsData !== false) {
            $allTreatments = json_decode($treatmentsData, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($allTreatments)) {
                // Extraire tous les event_id valides
                foreach ($allTreatments as $treatment) {
                    if (isset($treatment['event_id'])) {
                        $validEventIds[] = $treatment['event_id'];
                    }
                }
            }
        }
    }
    
    // Nettoyer les event_history de tous les inventaires
    $inventoryModified = false;
    foreach ($inventories as &$inventory) {
        if (isset($inventory['event_history']) && is_array($inventory['event_history'])) {
            $originalCount = count($inventory['event_history']);
            
            // Filtrer : garder les événements qui ne sont PAS de type "treatment"
            // OU dont l'event_id existe dans phyto_treatments_final.json
            $inventory['event_history'] = array_filter(
                $inventory['event_history'],
                function($event) use ($validEventIds) {
                    $eventType = $event['event_type'] ?? 'treatment';
                    
                    // Garder tous les événements qui ne sont pas des traitements
                    if ($eventType !== 'treatment') {
                        return true;
                    }
                    
                    // Pour les traitements, vérifier que l'event_id existe
                    $eventId = $event['event_id'] ?? '';
                    return in_array($eventId, $validEventIds, true);
                }
            );
            
            // Réindexer le tableau
            $inventory['event_history'] = array_values($inventory['event_history']);
            
            // Si des entrées ont été supprimées, recalculer le stock
            if (count($inventory['event_history']) < $originalCount) {
                $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
                $inventoryModified = true;
            }
        }
    }
    unset($inventory); // Libérer la référence
    
    foreach ($affectedTreatmentIds as $treatmentId) {
        // Trouver le traitement correspondant
        $treatmentData = null;
        foreach ($treatments as $treatment) {
            if (isset($treatment['event_id']) && $treatment['event_id'] === $treatmentId) {
                $treatmentData = $treatment;
                break;
            }
        }
        
        if (!$treatmentData) {
            continue;
        }
        
        // Vérifier que le traitement appartient à l'utilisateur connecté
        if ($userId && isset($treatmentData['id_user']) && $treatmentData['id_user'] !== $userId) {
            continue;
        }
        
        // Extraire les données avec unités
        $eventData = convertTreatmentToInventoryEventData($treatmentData);
        
        // Ignorer les événements sans produits
        if (empty($eventData['products'])) {
            continue;
        }
        
        // Ajouter userId si fourni
        if ($userId) {
            $eventData['id_user'] = $userId;
        }
        
        // Mettre à jour l'inventaire avec cet événement
        if (updateInventoryWithEventDirect($inventories, $eventData, $userId)) {
            $inventoryModified = true;
        }
    }
    
    // Sauvegarder le fichier inventaire si modifié
    if ($inventoryModified) {
        $jsonData = json_encode($inventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if (file_put_contents($inventoryPath, $jsonData) !== false) {
            return true;
        } else {
            return false;
        }
    }
    return true;
}

function updateInventoryWithEventDirect(&$inventories, $eventData, $userId = null) {
    $exploitationId = $eventData['exploitation_id'];
    $eventId = $eventData['event_id'];
    $eventDate = $eventData['event_date'];
    $eventCrop = $eventData['event_crop'] ?? '';
    $products = $eventData['products'];
    
    if (!$userId) {
        return false;
    }
        
    // Trouver l'inventaire pour cet utilisateur
    $targetInventoryIndex = -1;
    foreach ($inventories as $index => $inventory) {
        if (isset($inventory['id_user']) && $inventory['id_user'] === $userId) {
            $targetInventoryIndex = $index;
            break;
        }
    }
    
    // Si aucun inventaire n'existe, en créer un nouveau
    if ($targetInventoryIndex === -1) {
        $newInventory = [
            'inventory_id' => 'inv_' . uniqid(),
            'exploitation_id' => 'default',
            'event_history' => [],
            'inventory_stock' => [],
            'id_user' => $userId
        ];
        
        $inventories[] = $newInventory;
        $targetInventoryIndex = count($inventories) - 1;
    }
    
    $targetInventory = &$inventories[$targetInventoryIndex];
    
    // Supprimer les anciens événements pour cet event_id ET ce userId
    $targetInventory['event_history'] = array_filter($targetInventory['event_history'], function($event) use ($eventId, $userId) {
        return $event['event_id'] !== $eventId || 
               (isset($event['id_user']) && $event['id_user'] !== $userId);
    });
    $targetInventory['event_history'] = array_values($targetInventory['event_history']);
    
    // Créer un événement séparé pour chaque produit
    foreach ($products as $product) {
        $newEvent = [
            'event_id' => $eventId,
            'event_date' => $eventDate,
            'event_crop' => $eventCrop,
            'event_type' => $eventData['event_type'],
            'product_id' => $product['product_id'],
            'product_name' => $product['product_name'] ?? '',
            'product_numaut' => $product['product_numaut'] ?? '',
            'quantity_used' => floatval($product['quantity_used']),
            'quantity_used_unit' => $product['quantity_used_unit'] ?? 'L',
            'updated_at' => date('c'),
            'id_user' => $userId
        ];
        
        $targetInventory['event_history'][] = $newEvent;
    }
    
    // Recalculer le stock
    $userEvents = array_filter($targetInventory['event_history'], function($event) use ($userId) {
        return isset($event['id_user']) && $event['id_user'] === $userId;
    });
    
    $userStock = recalculateInventoryStock($userEvents);
    
    // Fusionner avec le stock existant
    $existingStock = $targetInventory['inventory_stock'] ?? [];
    $mergedStock = [];
    
    // Garder les stocks des autres utilisateurs
    foreach ($existingStock as $stock) {
        if (!isset($stock['id_user']) || $stock['id_user'] !== $userId) {
            $mergedStock[] = $stock;
        }
    }
    
    $mergedStock = array_merge($mergedStock, $userStock);
    $targetInventory['inventory_stock'] = $mergedStock;
    
    return true;
}

function generateInventoryId($exploitationId) {
    return 'inv-' . substr(str_replace('-', '', $exploitationId), 0, 8) . '-' . date('YmdHis') . '-' . substr(uniqid(), -4);
}

function recalculateInventoryStock($eventHistory) {
    $stockSummary = [];

    foreach ($eventHistory as $event) {
        $productId = $event['product_id'];
        $quantityUsed = floatval($event['quantity_used']);
        $eventType = $event['event_type'] ?? 'treatment';

        if (!isset($stockSummary[$productId])) {
            $quantityUnit = $event['quantity_used_unit'] ?? 'L';

            $stockSummary[$productId] = [
                'product_id' => $productId,
                'product_name' => $event['product_name'] ?? 'Produit inconnu',
                'product_numaut' => $event['product_numaut'] ?? '',
                'quantity_used' => 0,
                'quantity_buyed' => 0,
                'quantity_ppnu' => 0,
                'quantity_ppnv' => 0,
                'quantity_unit' => $quantityUnit,
                'id_user' => $event['id_user'] ?? null
            ];
        }

        // Ajouter aux bonnes quantités selon l'event_type
        if ($eventType === 'purchase') {
            $stockSummary[$productId]['quantity_buyed'] += $quantityUsed;
        } elseif ($eventType === 'ppnu_entry') {
            $stockSummary[$productId]['quantity_ppnu'] += $quantityUsed;
        } elseif ($eventType === 'ppnv_entry') {
            $stockSummary[$productId]['quantity_ppnv'] += $quantityUsed;
        } else {
            $stockSummary[$productId]['quantity_used'] += $quantityUsed;
        }
    }

    // Calculer current_stock
    foreach ($stockSummary as &$product) {
        $totalPurchased = $product['quantity_buyed'] + $product['quantity_ppnu'] + $product['quantity_ppnv'];
        $totalUsed = $product['quantity_used'];

        $product['total_purchased'] = $totalPurchased;
        $product['total_used'] = $totalUsed;
        $product['current_stock'] = $totalPurchased - $totalUsed;
        $product['updated_at'] = date('c');
    }

    return array_values($stockSummary);
}

function migrateEventTypes($inventories) {
    $migrated = false;
    
    foreach ($inventories as &$inventory) {
        if (isset($inventory['event_history']) && is_array($inventory['event_history'])) {
            foreach ($inventory['event_history'] as &$event) {
                if (!isset($event['event_type'])) {
                    if (isset($event['event_id']) && strpos($event['event_id'], 'purchase-') !== false) {
                        $event['event_type'] = 'purchase';
                    } elseif (!isset($event['event_crop']) || empty($event['event_crop'])) {
                        $event['event_type'] = 'purchase';
                    } else {
                        $event['event_type'] = 'treatment';
                    }
                    $migrated = true;
                }
            }
        }
    }
    
    return $inventories;
}

function migratePpnuPpnvToEventHistory($inventories) {
    $migrated = false;
    
    foreach ($inventories as &$inventory) {
        if (!isset($inventory['event_history'])) {
            $inventory['event_history'] = [];
        }
        
        if (isset($inventory['inventory_stock']) && is_array($inventory['inventory_stock'])) {
            foreach ($inventory['inventory_stock'] as &$product) {
                if (isset($product['ppnu_ppnv']) && is_array($product['ppnu_ppnv']) && !empty($product['ppnu_ppnv'])) {
                    $existingPpnuEvents = array_filter($inventory['event_history'], function($event) use ($product) {
                        return $event['product_id'] === $product['product_id'] && 
                               in_array($event['event_type'], ['ppnu_entry', 'ppnv_entry']);
                    });
                    
                    if (empty($existingPpnuEvents)) {
                        foreach ($product['ppnu_ppnv'] as $ppnuEntry) {
                            $eventType = ($ppnuEntry['type'] === 'PPNU') ? 'ppnu_entry' : 'ppnv_entry';
                            $eventId = 'ev-' . $eventType . '-' . uniqid() . '-' . bin2hex(random_bytes(4));
                            
                            $newEvent = [
                                'event_id' => $eventId,
                                'event_type' => $eventType,
                                'event_date' => date('Y-m-d'),
                                'product_id' => $product['product_id'],
                                'product_name' => $product['product_name'],
                                'product_numaut' => $product['product_numaut'] ?? '',
                                'quantity_used' => floatval($ppnuEntry['quantity'])
                            ];
                            
                            if (isset($inventory['id_user'])) {
                                $newEvent['id_user'] = $inventory['id_user'];
                            }
                            
                            $inventory['event_history'][] = $newEvent;
                            $migrated = true;
                        }
                        
                        unset($product['ppnu_ppnv']);
                        $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
                    }
                }
            }
        }
    }
    
    return $inventories;
}

function migrateEventsUserId($inventories) {
    $migrated = false;

    foreach ($inventories as &$inventory) {
        $inventoryUserId = $inventory['id_user'] ?? null;

        if ($inventoryUserId) {
            if (isset($inventory['event_history']) && is_array($inventory['event_history'])) {
                foreach ($inventory['event_history'] as &$event) {
                    if (!isset($event['id_user'])) {
                        $event['id_user'] = $inventoryUserId;
                        $migrated = true;
                    }
                }
            }

            if (isset($inventory['inventory_stock']) && is_array($inventory['inventory_stock'])) {
                foreach ($inventory['inventory_stock'] as &$stock) {
                    if (!isset($stock['id_user'])) {
                        $stock['id_user'] = $inventoryUserId;
                        $migrated = true;
                    }
                }
            }
        }
    }

    return $inventories;
}

function cleanZeroQuantityEvents($inventories) {
    foreach ($inventories as &$inventory) {
        if (!isset($inventory['event_history']) || !is_array($inventory['event_history'])) {
            continue;
        }
        
        // Filtrer les événements avec quantity_used == 0
        $inventory['event_history'] = array_filter($inventory['event_history'], function($event) {
            $quantityUsed = floatval($event['quantity_used'] ?? 0);
            return $quantityUsed != 0;
        });
        
        // Réindexer le tableau
        $inventory['event_history'] = array_values($inventory['event_history']);
        
        // Recalculer le stock après nettoyage
        if (!empty($inventory['event_history'])) {
            $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
        }
    }
    
    return $inventories;
}

function deletePpnuPpnvEntry(&$inventories, $requestData) {
    if (!isset($requestData['product_id']) || !isset($requestData['event_id'])) {
        return false;
    }
    
    $productId = $requestData['product_id'];
    $eventId = $requestData['event_id'];
    
    foreach ($inventories as &$inventory) {
        if (!isset($inventory['event_history'])) {
            continue;
        }
        
        $eventFound = false;
        foreach ($inventory['event_history'] as $index => $event) {
            if ($event['event_id'] === $eventId && 
                $event['product_id'] === $productId && 
                in_array($event['event_type'], ['ppnu_entry', 'ppnv_entry'])) {
                
                array_splice($inventory['event_history'], $index, 1);
                $eventFound = true;
                break;
            }
        }
        
        if ($eventFound) {
            $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
            return $inventories;
        }
    }
    
    return false;
}

function updatePpnuPpnvEntry(&$inventories, $requestData) {
    if (!isset($requestData['product_id']) || !isset($requestData['event_id']) || !isset($requestData['ppnu_ppnv_entry'])) {
        return false;
    }
    
    $productId = $requestData['product_id'];
    $eventId = $requestData['event_id'];
    $updatedEntry = $requestData['ppnu_ppnv_entry'];
    
    foreach ($inventories as &$inventory) {
        if (!isset($inventory['event_history'])) {
            continue;
        }
        
        foreach ($inventory['event_history'] as &$event) {
            if ($event['event_id'] === $eventId && 
                $event['product_id'] === $productId && 
                in_array($event['event_type'], ['ppnu_entry', 'ppnv_entry'])) {
                
                $newEventType = ($updatedEntry['type'] === 'PPNU') ? 'ppnu_entry' : 'ppnv_entry';
                $event['event_type'] = $newEventType;
                $event['quantity_used'] = floatval($updatedEntry['quantity']);
                $event['event_date'] = date('Y-m-d');
                                
                $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
                return $inventories;
            }
        }
    }
    
    return false;
}

function addPpnuPpnvEntry(&$inventories, $requestData, $authenticatedUserId = null) {
    if (!isset($requestData['product_id']) || !isset($requestData['ppnu_ppnv_entry'])) {
        return false;
    }
    
    $productId = $requestData['product_id'];
    $ppnuEntry = $requestData['ppnu_ppnv_entry'];
    $exploitationId = $requestData['exploitation_id'] ?? 'default';
    
    $userId = $authenticatedUserId ?? $requestData['id_user'] ?? null;
    
    if (!$userId || $userId === 'undefined' || $userId === 'null' || trim($userId) === '') {
        $userId = 'temp-' . date('Ymd-His') . '-' . uniqid();
    }
    
    if (!isset($ppnuEntry['type']) || !in_array($ppnuEntry['type'], ['PPNU', 'PPNV'])) {
        return false;
    }
    
    if (!isset($ppnuEntry['quantity']) || floatval($ppnuEntry['quantity']) <= 0) {
        return false;
    }
    
    $targetInventoryIndex = -1;
    
    foreach ($inventories as $index => $inventory) {
        if ($inventory['exploitation_id'] === $exploitationId && 
            isset($inventory['id_user']) && 
            $inventory['id_user'] === $userId) {
            $targetInventoryIndex = $index;
            break;
        }
    }
    
    if ($targetInventoryIndex === -1) {
        $newInventory = [
            'inventory_id' => generateInventoryId($exploitationId),
            'exploitation_id' => $exploitationId,
            'event_history' => [],
            'inventory_stock' => []
        ];
        
        if ($userId) {
            $newInventory['id_user'] = $userId;
        }
        
        $inventories[] = $newInventory;
        $targetInventoryIndex = count($inventories) - 1;
    }
    
    $targetInventory = &$inventories[$targetInventoryIndex];
    
    if (!isset($targetInventory['event_history'])) {
        $targetInventory['event_history'] = [];
    }
    
    $eventType = ($ppnuEntry['type'] === 'PPNU') ? 'ppnu_entry' : 'ppnv_entry';
    $eventId = 'ev-' . $eventType . '-' . uniqid() . '-' . bin2hex(random_bytes(4));
    
    $productName = $ppnuEntry['product_name'] ?? 'Produit inconnu';
    $productNumaut = $ppnuEntry['product_numaut'] ?? '';
    
    if ($productName === 'Produit inconnu' && isset($targetInventory['inventory_stock']) && is_array($targetInventory['inventory_stock'])) {
        foreach ($targetInventory['inventory_stock'] as $product) {
            if ($product['product_id'] === $productId) {
                $productName = $product['product_name'] ?? 'Produit inconnu';
                $productNumaut = $product['product_numaut'] ?? '';
                break;
            }
        }
    }
    
    $newEvent = [
        'event_id' => $eventId,
        'event_type' => $eventType,
        'event_date' => $ppnuEntry['date'] ?? date('Y-m-d'),
        'event_crop' => '',
        'product_id' => $productId,
        'product_name' => $productName,
        'product_numaut' => $productNumaut,
        'quantity_used' => floatval($ppnuEntry['quantity'])
    ];
    
    if ($userId) {
        $newEvent['id_user'] = $userId;
    }
    
    $targetInventory['event_history'][] = $newEvent;
    $targetInventory['inventory_stock'] = recalculateInventoryStock($targetInventory['event_history']);
    
    return $inventories;
}

// ============================================================================
// ROUTAGE HTTP
// ============================================================================

/**
 * Gère le bloc POST complet pour les inventaires.
 * Toujours appelle exit() en fin de traitement.
 */
function handleInventoryPostRoutes($file, $fullPath, $userId, $effectiveUserId, $newData) {
    if (!is_array($newData) || empty($newData) || is_bool($newData)) {
        http_response_code(400);
        echo json_encode(['error' => 'Données inventaire non conformes']);
        exit;
    }

    if (isset($newData['action']) && $newData['action'] === 'update_inventory_with_event') {
        $allInventories = [];
        if (is_file($fullPath)) {
            $existingContent = file_get_contents($fullPath);
            $allInventories = json_decode($existingContent, true) ?: [];
        }
        $updateResult = updateInventoryWithEventDirect($allInventories, $newData, $effectiveUserId);
        $finalInventories = $allInventories;
        if ($updateResult) {
            $tmpFile = $fullPath . '.tmp';
            $fpw = fopen($tmpFile, 'wb');
            if ($fpw) {
                $writeSuccess = false;
                if (flock($fpw, LOCK_EX)) {
                    $writeSuccess = fwrite($fpw, json_encode($finalInventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
                    fflush($fpw);
                    flock($fpw, LOCK_UN);
                }
                fclose($fpw);
                if ($writeSuccess && file_exists($tmpFile)) {
                    if (!rename($tmpFile, $fullPath)) {
                        if (file_exists($tmpFile)) { unlink($tmpFile); }
                        atomicWriteJsonFile($fullPath, $finalInventories);
                    }
                } else {
                    if (file_exists($tmpFile)) { unlink($tmpFile); }
                    atomicWriteJsonFile($fullPath, $finalInventories);
                }
            } else {
                atomicWriteJsonFile($fullPath, $finalInventories);
            }
        }
        echo json_encode(['success' => true, 'message' => 'Inventaire mis à jour avec succès']);
        exit;
    }

    if (isset($newData['action']) && $newData['action'] === 'delete_empty_product') {
        if (!isset($newData['product_id'])) {
            http_response_code(400);
            echo json_encode(['error' => 'product_id manquant pour la suppression']);
            exit;
        }
        $productId = $newData['product_id'];
        $allInventories = [];
        if (is_file($fullPath)) {
            $existingContent = file_get_contents($fullPath);
            $allInventories = json_decode($existingContent, true) ?: [];
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Fichier d\'inventaire non trouvé']);
            exit;
        }
        $productDeleted = false;
        foreach ($allInventories as &$inventory) {
            if (isset($inventory['id_user']) && $inventory['id_user'] === $userId) {
                if (isset($inventory['inventory_stock']) && is_array($inventory['inventory_stock'])) {
                    foreach ($inventory['inventory_stock'] as $index => $stock) {
                        if ($stock['product_id'] === $productId) {
                            $isEmpty = ($stock['quantity_buyed'] == 0) &&
                                       ($stock['quantity_ppnu'] == 0) &&
                                       ($stock['quantity_ppnv'] == 0) &&
                                       ($stock['quantity_used'] == 0) &&
                                       (($stock['total_used'] ?? 0) == 0);
                            if ($isEmpty) {
                                array_splice($inventory['inventory_stock'], $index, 1);
                                $productDeleted = true;
                                break 2;
                            } else {
                                http_response_code(400);
                                echo json_encode(['error' => 'Le produit n\'est pas vide et ne peut pas être supprimé']);
                                exit;
                            }
                        }
                    }
                }
                break;
            }
        }
        if (!$productDeleted) {
            http_response_code(404);
            echo json_encode(['error' => 'Produit non trouvé dans votre inventaire']);
            exit;
        }
        $tmpFile = $fullPath . '.tmp';
        $fpw = fopen($tmpFile, 'wb');
        if ($fpw) {
            $writeSuccess = false;
            if (flock($fpw, LOCK_EX)) {
                $writeSuccess = fwrite($fpw, json_encode($allInventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
                fflush($fpw);
                flock($fpw, LOCK_UN);
            }
            fclose($fpw);
            if ($writeSuccess && file_exists($tmpFile)) {
                if (!rename($tmpFile, $fullPath)) {
                    if (file_exists($tmpFile)) { unlink($tmpFile); }
                    atomicWriteJsonFile($fullPath, $allInventories);
                }
            } else {
                if (file_exists($tmpFile)) { unlink($tmpFile); }
                atomicWriteJsonFile($fullPath, $allInventories);
            }
        } else {
            atomicWriteJsonFile($fullPath, $allInventories);
        }
        echo json_encode(['success' => true, 'message' => 'Produit vide supprimé avec succès']);
        exit;
    }

    if (isset($newData['action']) && ($newData['action'] === 'add_ppnu_ppnv_entry' ||
          $newData['action'] === 'delete_ppnu_ppnv_entry' ||
          $newData['action'] === 'update_ppnu_ppnv_entry')) {
        $existingInventories = [];
        if (is_file($fullPath)) {
            $existingContent = file_get_contents($fullPath);
            $existingInventories = json_decode($existingContent, true) ?: [];
        }
        $existingInventories = migrateEventTypes($existingInventories);
        $needsPpnuMigration = false;
        foreach ($existingInventories as $inventory) {
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
            $existingInventories = migratePpnuPpnvToEventHistory($existingInventories);
        }
        $existingInventories = migrateEventsUserId($existingInventories);
        $actionResult = false;
        $errorMessage = '';
        switch ($newData['action']) {
            case 'add_ppnu_ppnv_entry':
                $actionResult = addPpnuPpnvEntry($existingInventories, $newData, $effectiveUserId);
                $errorMessage = 'Erreur lors de l\'ajout de l\'entrée PPNU/PPNV';
                break;
            case 'delete_ppnu_ppnv_entry':
                $actionResult = deletePpnuPpnvEntry($existingInventories, $newData);
                $errorMessage = 'Erreur lors de la suppression de l\'événement PPNU/PPNV';
                break;
            case 'update_ppnu_ppnv_entry':
                $actionResult = updatePpnuPpnvEntry($existingInventories, $newData);
                $errorMessage = 'Erreur lors de la mise à jour de l\'événement PPNU/PPNV';
                break;
        }
        if ($actionResult) {
            $tmpFile = $fullPath . '.tmp';
            $fpw = fopen($tmpFile, 'wb');
            if ($fpw) {
                $writeSuccess = false;
                if (flock($fpw, LOCK_EX)) {
                    $writeSuccess = fwrite($fpw, json_encode($existingInventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
                    fflush($fpw);
                    flock($fpw, LOCK_UN);
                }
                fclose($fpw);
                if ($writeSuccess && file_exists($tmpFile)) {
                    if (!rename($tmpFile, $fullPath)) {
                        if (file_exists($tmpFile)) { unlink($tmpFile); }
                        atomicWriteJsonFile($fullPath, $existingInventories);
                    }
                } else {
                    if (file_exists($tmpFile)) { unlink($tmpFile); }
                    atomicWriteJsonFile($fullPath, $existingInventories);
                }
            } else {
                atomicWriteJsonFile($fullPath, $existingInventories);
            }
            echo json_encode(['success' => true, 'message' => 'Action PPNU/PPNV exécutée avec succès']);
            exit;
        } else {
            http_response_code(400);
            echo json_encode(['error' => $errorMessage]);
            exit;
        }
    }

    // Fallback : remplacement complet (pour les actions non reconnues)
    if (isset($newData['action']) && in_array($newData['action'], [
        'delete_empty_product', 'update_inventory_with_event',
        'add_ppnu_ppnv_entry', 'delete_ppnu_ppnv_entry', 'update_ppnu_ppnv_entry'
    ])) {
        http_response_code(400);
        echo json_encode(['error' => 'Action non reconnue ou mal formée: ' . $newData['action']]);
        exit;
    }
    if (!is_array($newData) || is_bool($newData) || $newData === true || $newData === false) {
        http_response_code(400);
        echo json_encode(['error' => 'Données d\'inventaire invalides: doit être un tableau d\'objets, pas un booléen']);
        exit;
    }
    if (is_array($newData) && array_values($newData) === $newData) {
        $result = $newData;
    } else {
        $result = [$newData];
    }
    addUserIdToData($result, $effectiveUserId);
    $tmpFile = $fullPath . '.tmp';
    $fpw = fopen($tmpFile, 'wb');
    if ($fpw) {
        $writeSuccess = false;
        if (flock($fpw, LOCK_EX)) {
            $writeSuccess = fwrite($fpw, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
            fflush($fpw);
            flock($fpw, LOCK_UN);
        }
        fclose($fpw);
        if ($writeSuccess && file_exists($tmpFile)) {
            if (!rename($tmpFile, $fullPath)) {
                if (file_exists($tmpFile)) { unlink($tmpFile); }
                atomicWriteJsonFile($fullPath, $result);
            }
        } else {
            if (file_exists($tmpFile)) { unlink($tmpFile); }
            atomicWriteJsonFile($fullPath, $result);
        }
    } else {
        atomicWriteJsonFile($fullPath, $result);
    }
    echo json_encode(['success' => true, 'message' => 'Inventaire mis à jour avec succès']);
    exit;
}

/**
 * Dispatch les actions DELETE/PUT liées aux inventaires.
 * Appelle exit() si une action est traitée, sinon retourne sans rien faire.
 */
function handleInventoryActionRoutes($method, $action, $fullPath, $baseDir, $userId, $effectiveUserId) {
    if ($method === 'DELETE') {
        if ($action === 'remove_event_from_inventory') {
            $eventId = $_GET['event_id'] ?? null;
            if (!$eventId) {
                http_response_code(400);
                echo json_encode([
                    'error' => 'Paramètre event_id requis.',
                    'provided' => ['event_id' => $_GET['event_id'] ?? 'missing']
                ]);
                exit;
            }
            if (!is_file($fullPath)) {
                http_response_code(404);
                echo json_encode(['error' => 'Fichier inventaire non trouvé.']);
                exit;
            }
            $content = file_get_contents($fullPath);
            $inventories = json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($inventories)) {
                http_response_code(400);
                echo json_encode(['error' => 'Fichier inventaire JSON invalide.']);
                exit;
            }
            $found = false;
            foreach ($inventories as &$inventory) {
                if (isset($inventory['event_history'])) {
                    $originalCount = count($inventory['event_history']);
                    $inventory['event_history'] = array_filter(
                        $inventory['event_history'],
                        function($event) use ($eventId) { return $event['event_id'] !== $eventId; }
                    );
                    $inventory['event_history'] = array_values($inventory['event_history']);
                    if (count($inventory['event_history']) < $originalCount) {
                        $found = true;
                        $inventory['inventory_stock'] = recalculateInventoryStock($inventory['event_history']);
                    }
                }
            }
            if ($found) {
                $tmpFile = $fullPath . '.tmp';
                $fpw = fopen($tmpFile, 'wb');
                if ($fpw) {
                    $writeSuccess = false;
                    if (flock($fpw, LOCK_EX)) {
                        $writeSuccess = fwrite($fpw, json_encode($inventories, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) !== false;
                        fflush($fpw);
                        flock($fpw, LOCK_UN);
                    }
                    fclose($fpw);
                    if ($writeSuccess && file_exists($tmpFile)) {
                        if (!rename($tmpFile, $fullPath)) {
                            if (file_exists($tmpFile)) { unlink($tmpFile); }
                            atomicWriteJsonFile($fullPath, $inventories);
                        }
                    } else {
                        if (file_exists($tmpFile)) { unlink($tmpFile); }
                        atomicWriteJsonFile($fullPath, $inventories);
                    }
                } else {
                    atomicWriteJsonFile($fullPath, $inventories);
                }
                echo json_encode([
                    'success' => true,
                    'message' => "Événement $eventId supprimé de l'inventaire et inventory_stock recalculé"
                ]);
            } else {
                echo json_encode([
                    'success' => true,
                    'message' => "Aucun événement $eventId trouvé dans l'inventaire"
                ]);
            }
            exit;
        }

        if ($action === 'delete_ppnu_ppnv_entry') {
            parse_str(file_get_contents("php://input"), $deleteParams);
            $productId = $deleteParams['product_id'] ?? null;
            $entryIndex = isset($deleteParams['entry_index']) ? intval($deleteParams['entry_index']) : null;
            if (!$productId || $entryIndex === null) {
                http_response_code(400);
                echo json_encode([
                    'error' => 'Paramètres product_id et entry_index requis.',
                    'provided' => [
                        'product_id' => $productId ?? 'missing',
                        'entry_index' => $entryIndex ?? 'missing'
                    ]
                ]);
                exit;
            }
            if (!is_file($fullPath)) {
                http_response_code(404);
                echo json_encode(['error' => 'Fichier inventaire non trouvé.']);
                exit;
            }
            $content = file_get_contents($fullPath);
            $inventories = json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($inventories)) {
                http_response_code(400);
                echo json_encode(['error' => 'Fichier inventaire JSON invalide.']);
                exit;
            }
            $requestData = ['product_id' => $productId, 'entry_index' => $entryIndex];
            $result = deletePpnuPpnvEntry($inventories, $requestData);
            if ($result) {
                atomicWriteJsonFile($fullPath, $inventories);
                echo json_encode([
                    'success' => true,
                    'message' => "Entrée PPNU/PPNV supprimée avec succès pour le produit $productId"
                ]);
            } else {
                http_response_code(400);
                echo json_encode(['error' => 'Erreur lors de la suppression de l\'entrée PPNU/PPNV']);
            }
            exit;
        }
    }

    if ($method === 'PUT') {
        if ($action === 'update_ppnu_ppnv_entry') {
            $input = file_get_contents('php://input');
            $updateData = json_decode($input, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                http_response_code(400);
                echo json_encode(['error' => 'Données JSON invalides']);
                exit;
            }
            if (!is_file($fullPath)) {
                http_response_code(404);
                echo json_encode(['error' => 'Fichier inventaire non trouvé.']);
                exit;
            }
            $content = file_get_contents($fullPath);
            $inventories = json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($inventories)) {
                http_response_code(400);
                echo json_encode(['error' => 'Fichier inventaire JSON invalide.']);
                exit;
            }
            $result = updatePpnuPpnvEntry($inventories, $updateData);
            if ($result) {
                atomicWriteJsonFile($fullPath, $inventories);
                echo json_encode(['success' => true, 'message' => "Entrée PPNU/PPNV mise à jour avec succès"]);
            } else {
                http_response_code(400);
                echo json_encode(['error' => 'Erreur lors de la mise à jour de l\'entrée PPNU/PPNV']);
            }
            exit;
        }

        if ($action === 'update_purchase_event') {
            $input = file_get_contents('php://input');
            $updateData = json_decode($input, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                http_response_code(400);
                echo json_encode(['error' => 'Données JSON invalides']);
                exit;
            }
            if (!is_file($fullPath)) {
                http_response_code(404);
                echo json_encode(['error' => 'Fichier inventaire non trouvé.']);
                exit;
            }
            $content = file_get_contents($fullPath);
            $inventories = json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($inventories)) {
                http_response_code(400);
                echo json_encode(['error' => 'Fichier inventaire JSON invalide.']);
                exit;
            }
            $result = updateInventoryWithEventDirect($inventories, $updateData, $effectiveUserId);
            if ($result) {
                atomicWriteJsonFile($fullPath, $inventories);
                echo json_encode(['success' => true, 'message' => "Événement d'achat mis à jour avec succès"]);
            } else {
                http_response_code(400);
                echo json_encode(['error' => 'Erreur lors de la mise à jour de l\'événement d\'achat']);
            }
            exit;
        }
    }
}
?>
