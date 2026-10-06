<?php
/**
 * Fonctions utilitaires pour la gestion des fichiers JSON
 * Lecture, écriture, validation
 */

function readJsonFile($filePath) {
    if (!is_file($filePath)) {
        return null;
    }
    
    $content = file_get_contents($filePath);
    if ($content === false) {
        return null;
    }
    
    if (trim($content) === '') {
        return null;
    }
    
    $data = json_decode($content, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return null;
    }
    
    return $data;
}

function writeJsonFile($filePath, $data, $atomic = true) {
    $jsonData = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
    if ($atomic) {
        return writeJsonFileAtomic($filePath, $jsonData);
    }
    
    $result = file_put_contents($filePath, $jsonData);
    return $result !== false;
}

function atomicWriteJsonFile($filePath, $data) {
    $jsonData = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return writeJsonFileAtomic($filePath, $jsonData);
}

function writeJsonFileAtomic($filePath, $jsonData) {
    $tmpFile = $filePath . '.tmp';
    $fpw = fopen($tmpFile, 'wb');
    
    if (!$fpw) {
        file_put_contents($filePath, $jsonData);
        return true;
    }
    
    $writeSuccess = false;
    if (flock($fpw, LOCK_EX)) {
        $writeSuccess = fwrite($fpw, $jsonData) !== false;
        fflush($fpw);
        flock($fpw, LOCK_UN);
    }
    fclose($fpw);
    
    if ($writeSuccess && file_exists($tmpFile)) {
        if (!rename($tmpFile, $filePath)) {
            if (file_exists($tmpFile)) {
                unlink($tmpFile);
            }
            file_put_contents($filePath, $jsonData);
        }
    } else {
        if (file_exists($tmpFile)) {
            unlink($tmpFile);
        }
        file_put_contents($filePath, $jsonData);
    }
    
    return true;
}

function findEntryById($data, $id, $idKey = 'id') {
    if (!is_array($data)) {
        return null;
    }
    
    foreach ($data as $index => $entry) {
        if (isset($entry[$idKey]) && $entry[$idKey] === $id) {
            return ['entry' => $entry, 'index' => $index];
        }
    }
    
    return null;
}

function removeEntryById(&$data, $id, $idKey = 'id') {
    if (!is_array($data)) {
        return false;
    }
    
    foreach ($data as $index => $entry) {
        if (isset($entry[$idKey]) && $entry[$idKey] === $id) {
            array_splice($data, $index, 1);
            return true;
        }
    }
    
    return false;
}

function updateEntryById(&$data, $id, $updateData, $idKey = 'id') {
    if (!is_array($data)) {
        return false;
    }
    
    foreach ($data as &$entry) {
        if (isset($entry[$idKey]) && $entry[$idKey] === $id) {
            foreach ($updateData as $key => $value) {
                $entry[$key] = $value;
            }
            return true;
        }
    }
    
    return false;
}

function validateJsonInput() {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        return ['success' => false, 'error' => 'JSON invalide'];
    }
    
    return ['success' => true, 'data' => $data];
}

/**
 * Fusionne $newData dans le fichier JSON existant à $fullPath,
 * déduplique par ID utilisateur, normalise les traitements phyto,
 * écrit le résultat atomiquement et retourne le tableau résultant.
 */
function mergeJsonFile($fullPath, $file, $newData, $effectiveUserId) {
    $result        = null;
    $isPhytoFinal  = (strpos($file, 'phyto_treatments_final.json') !== false);
    $isCropsFile   = (strpos($file, 'crops/crops.json') !== false);
    $idFields      = ['event_id', 'crop_id', 'travaux_aux_champs_id', 'exploitation_id'];

    if (is_file($fullPath)) {
        $oldData = json_decode(file_get_contents($fullPath), true);
        if (!is_array($oldData)) { $oldData = []; }
        $oldData = array_values($oldData);

        // Dedup par event_id avant fusion (phyto_treatments_final uniquement)
        if ($isPhytoFinal) {
            $newEventIds = [];
            if (is_array($newData) && array_values($newData) === $newData) {
                foreach ($newData as $item) {
                    if (isset($item['event_id'])) $newEventIds[] = $item['event_id'];
                }
            } elseif (isset($newData['event_id'])) {
                $newEventIds[] = $newData['event_id'];
            }
            if (!empty($newEventIds)) {
                $oldData = array_values(array_filter($oldData, function($t) use ($newEventIds) {
                    return !isset($t['event_id']) || !in_array($t['event_id'], $newEventIds);
                }));
            }
        }

        if (is_array($newData) && array_values($newData) === $newData) {
            // Tableau d'items : retirer les doublons de l'utilisateur courant
            $newIds = [];
            foreach ($newData as $item) {
                foreach ($idFields as $k) {
                    if (isset($item[$k])) { $newIds[] = $item[$k]; break; }
                }
            }
            $oldData = array_values(array_filter($oldData, function($item) use ($effectiveUserId, $newIds, $idFields) {
                if (isset($item['id_user']) && $item['id_user'] === $effectiveUserId) {
                    foreach ($idFields as $k) {
                        if (isset($item[$k]) && in_array($item[$k], $newIds)) return false;
                    }
                }
                return true;
            }));
            addUserIdToData($newData, $effectiveUserId);
            $result = array_merge($oldData, $newData);
        } else {
            // Item unique
            $newId = null;
            foreach ($idFields as $k) {
                if (isset($newData[$k])) { $newId = $newData[$k]; break; }
            }
            $oldData = array_values(array_filter($oldData, function($item) use ($effectiveUserId, $newId, $idFields) {
                if (isset($item['id_user']) && $item['id_user'] === $effectiveUserId) {
                    foreach ($idFields as $k) {
                        if (isset($item[$k]) && $item[$k] === $newId) return false;
                    }
                }
                return true;
            }));
            addUserIdToData($newData, $effectiveUserId);
            if ($isCropsFile && isset($newData['crop_id'])) {
                enrichCropWithArchiveFields($newData);
            }
            $result   = $oldData;
            $result[] = $newData;
        }
    }

    // Fichier inexistant ou vide
    if ($result === null) {
        $result = [];
        if (is_array($newData) && array_values($newData) === $newData) {
            addUserIdToData($newData, $effectiveUserId);
            if ($isCropsFile) {
                foreach ($newData as &$crop) {
                    if (isset($crop['crop_id'])) enrichCropWithArchiveFields($crop);
                }
                unset($crop);
            }
            foreach ($newData as &$treatment) {
                if ($isPhytoFinal && isset($treatment['event_id'])) {
                    normalizePhytoTreatmentStructure($treatment);
                    consolidateAllTreatmentCalculations($treatment);
                }
            }
            unset($treatment);
            $result = $newData;
        } else {
            addUserIdToData($newData, $effectiveUserId);
            if ($isCropsFile && isset($newData['crop_id'])) {
                enrichCropWithArchiveFields($newData);
            }
            if ($isPhytoFinal && isset($newData['event_id'])) {
                normalizePhytoTreatmentStructure($newData);
                consolidateAllTreatmentCalculations($newData);
            }
            $result[] = $newData;
        }
    }

    // Normalisation finale de la structure pour tous les traitements phyto
    if ($isPhytoFinal && is_array($result)) {
        foreach ($result as &$treatment) {
            if (is_array($treatment) && isset($treatment['event_id'])) {
                normalizePhytoTreatmentStructure($treatment);
            }
        }
        unset($treatment);
    }

    atomicWriteJsonFile($fullPath, $result);
    return $result;
}
?>
