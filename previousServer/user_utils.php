<?php
/**
 * Fonctions utilitaires pour la gestion des utilisateurs
 * Filtrage et ajout d'ID utilisateur aux données
 */

/**
 * Normalise un enregistrement users_infos vers les nouveaux noms de champs.
 * Idempotent : sans effet si les champs sont déjà migrés.
 */
function normalizeUserInfoStructure(&$entry) {
    if (!is_array($entry)) return;

    // numeroDePhytolicence → phytolicence
    if (array_key_exists('numeroDePhytolicence', $entry) && !array_key_exists('phytolicence', $entry)) {
        $entry['phytolicence'] = $entry['numeroDePhytolicence'];
        unset($entry['numeroDePhytolicence']);
    }
    // numeroDexploitant → exploiting_number
    if (array_key_exists('numeroDexploitant', $entry) && !array_key_exists('exploiting_number', $entry)) {
        $entry['exploiting_number'] = $entry['numeroDexploitant'];
        unset($entry['numeroDexploitant']);
    }
    // datee → date
    if (array_key_exists('datee', $entry) && !array_key_exists('date', $entry)) {
        $entry['date'] = $entry['datee'];
        unset($entry['datee']);
    }
}

function filterDataByUserId($data, $userId) {
    if (!is_array($data) || empty($userId)) {
        return [];
    }

    $filtered = [];
    foreach ($data as $inventory) {
        $keep = false;
        
        // Garder UNIQUEMENT si l'inventaire a l'id_user correct
        if (isset($inventory['id_user']) && $inventory['id_user'] === $userId) {
            $keep = true;
        }
        
        if ($keep) {
            // FILTRER STRICTEMENT : ne garder que les événements et stocks de l'utilisateur
            $filteredInventory = $inventory;
            
            if (isset($inventory['event_history']) && is_array($inventory['event_history'])) {
                $filteredInventory['event_history'] = array_filter($inventory['event_history'], function($event) use ($userId) {
                    return isset($event['id_user']) && $event['id_user'] === $userId;
                });
                $filteredInventory['event_history'] = array_values($filteredInventory['event_history']);
            }

            if (isset($inventory['inventory_stock']) && is_array($inventory['inventory_stock'])) {
                $filteredInventory['inventory_stock'] = array_filter($inventory['inventory_stock'], function($stock) use ($userId) {
                    return isset($stock['id_user']) && $stock['id_user'] === $userId;
                });
                $filteredInventory['inventory_stock'] = array_values($filteredInventory['inventory_stock']);
            }
            
            $filtered[] = $filteredInventory;
        }
    }

    return $filtered;
}

function addUserIdToData(&$data, $userId) {
    if (empty($userId)) {
        return;
    }
    
    if (is_array($data)) {
        // Si c'est un tableau d'objets
        if (array_values($data) === $data) {
            // Tableau indexé - ajouter id_user à chaque élément
            foreach ($data as &$item) {
                if (is_array($item)) {
                    $item['id_user'] = $userId;
                }
            }
        } else {
            // Objet unique - ajouter id_user
            $data['id_user'] = $userId;
        }
    }
}

/**
 * Gère les POST pour les routes publiques :
 * index/, users_infos.json, exploitation/exploitations.json.
 * Appelle exit() dans tous les cas si la route correspond.
 */
function handlePublicPostRoutes($file, $fullPath, $baseDir) {
    if (strpos($file, 'index/') !== 0 &&
        $file !== 'users_infos.json' &&
        $file !== 'exploitation/exploitations.json') {
        return;
    }

    $input   = file_get_contents('php://input');
    $newData = json_decode($input, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        http_response_code(400);
        echo json_encode(['error' => 'Le contenu envoyé n\'est pas un JSON valide.']);
        exit;
    }

    $result      = null;
    $tokenUserId = null;

    if ($file === 'users_infos.json' || $file === 'exploitation/exploitations.json') {
        $tokenUserId = authenticateAndGetUserId();
        if ($tokenUserId === null || empty($tokenUserId)) {
            http_response_code(401);
            echo json_encode(['error' => 'Authentification requise. Veuillez vous connecter.']);
            exit;
        }

        $oldData = [];
        if (is_file($fullPath)) {
            $oldContent = file_get_contents($fullPath);
            $oldData    = json_decode($oldContent, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($oldData)) {
                $oldData = [];
            }
        }

        // Injecter l'id_user dans les données reçues
        if (is_array($newData)) {
            if (array_values($newData) === $newData && isset($newData[0])) {
                $newData[0]['id_user'] = $tokenUserId;
            } else {
                $newData['id_user'] = $tokenUserId;
            }
        }

        // Normaliser les champs users_infos vers les nouveaux noms
        if ($file === 'users_infos.json') {
            if (is_array($newData) && array_values($newData) === $newData) {
                foreach ($newData as &$item) { normalizeUserInfoStructure($item); }
                unset($item);
            } else {
                normalizeUserInfoStructure($newData);
            }
        }

        // Supprimer l'entrée existante pour cet utilisateur
        $oldData = array_values(array_filter($oldData, function($item) use ($tokenUserId) {
            return !(isset($item['id_user']) && $item['id_user'] === $tokenUserId);
        }));

        if (is_array($newData) && array_values($newData) === $newData) {
            $result = array_merge($oldData, $newData);
        } else {
            $result   = $oldData;
            $result[] = $newData;
        }
    } else {
        // Documents publics index/ : logique simple (pas d'authentification)
        if (is_file($fullPath)) {
            $oldContent = file_get_contents($fullPath);
            $oldData    = json_decode($oldContent, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($oldData)) {
                if (is_array($newData) && array_values($newData) === $newData) {
                    $result = array_merge($oldData, $newData);
                } else {
                    $result   = $oldData;
                    $result[] = $newData;
                }
            }
        }
        if ($result === null) {
            $result = (is_array($newData) && array_values($newData) === $newData) ? $newData : [$newData];
        }
    }

    atomicWriteJsonFile($fullPath, $result);

    // Création automatique d'un opérateur lors de la première création d'exploitation
    if ($file === 'exploitation/exploitations.json') {
        _createOperatorForExploitation($result, $tokenUserId, $baseDir);
    }

    echo json_encode(['success' => true, 'result' => $result]);
    exit;
}

function _createOperatorForExploitation($result, $userId, $baseDir) {
    $createdExploitation = null;
    foreach ($result as $exploit) {
        if (isset($exploit['id_user']) && $exploit['id_user'] === $userId) {
            $createdExploitation = $exploit;
            break;
        }
    }
    if (!$createdExploitation) {
        return;
    }

    $userPhytolicence = '';
    $userInfosPath    = $baseDir . 'users_infos.json';
    if (is_file($userInfosPath)) {
        $usersInfos = json_decode(file_get_contents($userInfosPath), true);
        if (is_array($usersInfos)) {
            foreach ($usersInfos as $userInfo) {
                if (isset($userInfo['id_user']) && $userInfo['id_user'] === $userId) {
                    $userPhytolicence = $userInfo['phytolicence'] ?? $userInfo['numeroDePhytolicence'] ?? '';
                    break;
                }
            }
        }
    }

    $operatorsPath = $baseDir . 'exploitation/operators.json';
    $operators     = is_file($operatorsPath)
        ? (json_decode(file_get_contents($operatorsPath), true) ?: [])
        : [];
    foreach ($operators as $op) {
        if (isset($op['id_user']) && $op['id_user'] === $userId) {
            return; // opérateur déjà existant
        }
    }

    $operators[] = [
        'id_user'      => $userId,
        'name'         => trim(($createdExploitation['user_prenom'] ?? '') . ' ' . ($createdExploitation['user_nom'] ?? '')),
        'phytolicence' => $createdExploitation['phytolicence'] ?? $createdExploitation['numeroDePhytolicence'] ?? $userPhytolicence,
        'mail'         => ($createdExploitation['user_email'] ?? '') ?: null,
        'id_operator'  => '',
        'authorisation'=> 'Editer le registre',
        'date'         => (new \DateTime('now', new \DateTimeZone('Europe/Brussels')))->format('c'),
        'succes'       => true
    ];

    atomicWriteJsonFile($operatorsPath, $operators);
}
?>
