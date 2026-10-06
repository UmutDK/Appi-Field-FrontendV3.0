<?php
/**
 * Gestionnaire des formations
 * Permet de gérer le fichier formations.json (CRUD)
 * 
 * Méthodes supportées:
 * - GET: Récupère toutes les formations
 * - POST: Crée une nouvelle formation
 * - PUT: Modifie une formation existante (paramètre index requis)
 * - DELETE: Supprime une formation (paramètre index requis)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Gérer les requêtes OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Chemin vers le fichier formations.json
$formationsFile = __DIR__ . '/index/formations.json';

/**
 * Lit le contenu du fichier formations.json
 */
function readFormations($file) {
    if (!file_exists($file)) {
        return [];
    }
    
    $content = file_get_contents($file);
    $formations = json_decode($content, true);
    
    return is_array($formations) ? $formations : [];
}

/**
 * Écrit les formations dans le fichier JSON
 */
function writeFormations($file, $formations) {
    $jsonContent = json_encode($formations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($file, $jsonContent) !== false;
}

/**
 * Valide les données d'une formation
 */
function validateFormation($data) {
    $required = ['day', 'month', 'title', 'location', 'time', 'link'];
    
    foreach ($required as $field) {
        if (!isset($data[$field]) || trim($data[$field]) === '') {
            return false;
        }
    }
    
    // Vérifier que le lien commence par https:// ou mailto:
    if (!preg_match('/^(https?:\/\/|mailto:)/', $data['link'])) {
        return false;
    }
    
    return true;
}

/**
 * Envoie une réponse JSON
 */
function sendResponse($success, $message, $data = null, $code = 200) {
    http_response_code($code);
    $response = [
        'success' => $success,
        'message' => $message
    ];
    
    if ($data !== null) {
        $response['data'] = $data;
    }
    
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit();
}

// Traiter la requête selon la méthode HTTP
$method = $_SERVER['REQUEST_METHOD'];

try {
    switch ($method) {
        case 'GET':
            // Récupérer toutes les formations - renvoyer directement le tableau
            $formations = readFormations($formationsFile);
            http_response_code(200);
            echo json_encode($formations, JSON_UNESCAPED_UNICODE);
            exit();
            break;
            
        case 'POST':
            // Créer une nouvelle formation
            $input = json_decode(file_get_contents('php://input'), true);
            
            if (!validateFormation($input)) {
                sendResponse(false, 'Données invalides. Tous les champs sont requis et le lien doit commencer par https:// ou mailto:', null, 400);
            }
            
            $formations = readFormations($formationsFile);
            $formations[] = $input;
            
            if (writeFormations($formationsFile, $formations)) {
                sendResponse(true, 'Formation créée avec succès', $input, 201);
            } else {
                sendResponse(false, 'Erreur lors de l\'enregistrement', null, 500);
            }
            break;
            
        case 'PUT':
            // Vérifier si c'est un déplacement ou une modification
            if (isset($_GET['move']) && in_array($_GET['move'], ['up', 'down'])) {
                // Déplacer une formation
                if (!isset($_GET['index']) || !is_numeric($_GET['index'])) {
                    sendResponse(false, 'Index manquant ou invalide', null, 400);
                }
                
                $index = (int)$_GET['index'];
                $direction = $_GET['move'];
                $formations = readFormations($formationsFile);
                
                if (!isset($formations[$index])) {
                    sendResponse(false, 'Formation non trouvée', null, 404);
                }
                
                // Vérifier les limites
                if ($direction === 'up' && $index === 0) {
                    sendResponse(false, 'Impossible de monter la première formation', null, 400);
                }
                
                if ($direction === 'down' && $index === count($formations) - 1) {
                    sendResponse(false, 'Impossible de descendre la dernière formation', null, 400);
                }
                
                // Échanger les positions
                $newIndex = ($direction === 'up') ? $index - 1 : $index + 1;
                $temp = $formations[$index];
                $formations[$index] = $formations[$newIndex];
                $formations[$newIndex] = $temp;
                
                if (writeFormations($formationsFile, $formations)) {
                    sendResponse(true, 'Formation déplacée avec succès');
                } else {
                    sendResponse(false, 'Erreur lors du déplacement', null, 500);
                }
            } else {
                // Modifier une formation existante
                if (!isset($_GET['index']) || !is_numeric($_GET['index'])) {
                    sendResponse(false, 'Index manquant ou invalide', null, 400);
                }
                
                $index = (int)$_GET['index'];
                $input = json_decode(file_get_contents('php://input'), true);
                
                if (!validateFormation($input)) {
                    sendResponse(false, 'Données invalides', null, 400);
                }
                
                $formations = readFormations($formationsFile);
                
                if (!isset($formations[$index])) {
                    sendResponse(false, 'Formation non trouvée', null, 404);
                }
                
                $formations[$index] = $input;
                
                if (writeFormations($formationsFile, $formations)) {
                    sendResponse(true, 'Formation modifiée avec succès', $input);
                } else {
                    sendResponse(false, 'Erreur lors de la modification', null, 500);
                }
            }
            break;
            
        case 'DELETE':
            // Supprimer une formation
            if (!isset($_GET['index']) || !is_numeric($_GET['index'])) {
                sendResponse(false, 'Index manquant ou invalide', null, 400);
            }
            
            $index = (int)$_GET['index'];
            $formations = readFormations($formationsFile);
            
            if (!isset($formations[$index])) {
                sendResponse(false, 'Formation non trouvée', null, 404);
            }
            
            array_splice($formations, $index, 1);
            
            if (writeFormations($formationsFile, $formations)) {
                sendResponse(true, 'Formation supprimée avec succès');
            } else {
                sendResponse(false, 'Erreur lors de la suppression', null, 500);
            }
            break;
            
        default:
            sendResponse(false, 'Méthode non supportée', null, 405);
            break;
    }
} catch (Exception $e) {
    sendResponse(false, 'Erreur serveur: ' . $e->getMessage(), null, 500);
}
