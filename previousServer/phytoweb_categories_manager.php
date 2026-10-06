<?php
/**
 * Gestionnaire des catégories Phytoweb
 * Permet de gérer le fichier phytoweb_crops.json (CRUD)
 *
 * Méthodes supportées:
 * - GET    : Récupère toutes les catégories
 * - POST   : Crée une nouvelle catégorie personnalisée
 * - PUT    : Modifie le name_fr d'une catégorie personnalisée OU le visible_statut d'une catégorie initiale (?crop_id=)
 * - DELETE : Supprime une catégorie personnalisée (?crop_id=)
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$phytowebFile = __DIR__ . '/index/phytoweb_crops.json';

// ─── Helpers ────────────────────────────────────────────────────────────────

function readCategories($file) {
    if (!file_exists($file)) return [];
    $content = file_get_contents($file);
    $data    = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function writeCategories($file, $data) {
    $json = json_encode(array_values($data), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    return file_put_contents($file, $json) !== false;
}

function sendResponse($success, $message, $data = null, $code = 200) {
    http_response_code($code);
    $response = ['success' => $success, 'message' => $message];
    if ($data !== null) $response['data'] = $data;
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit();
}

function generateUUID() {
    $data    = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40); // version 4
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80); // variant
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

// ─── Routing ────────────────────────────────────────────────────────────────

$method = $_SERVER['REQUEST_METHOD'];

try {
    switch ($method) {

        // ── GET ─────────────────────────────────────────────────────────────
        case 'GET':
            $categories = readCategories($phytowebFile);
            http_response_code(200);
            echo json_encode($categories, JSON_UNESCAPED_UNICODE);
            exit();

        // ── POST ────────────────────────────────────────────────────────────
        case 'POST':
            $input = json_decode(file_get_contents('php://input'), true);

            if (!isset($input['name_fr']) || trim($input['name_fr']) === '') {
                sendResponse(false, 'Le champ name_fr est requis', null, 400);
            }
            if (!isset($input['initial_crop_id']) || trim($input['initial_crop_id']) === '') {
                sendResponse(false, 'Le champ initial_crop_id est requis', null, 400);
            }

            // Vérifier que la base est bien une catégorie initiale
            $categories = readCategories($phytowebFile);
            $baseExists = false;
            foreach ($categories as $cat) {
                if ($cat['crop_id'] === $input['initial_crop_id']
                    && $cat['crop_id'] === ($cat['initial_crop_id'] ?? $cat['crop_id'])) {
                    $baseExists = true;
                    break;
                }
            }
            if (!$baseExists) {
                sendResponse(false, 'La catégorie de base est introuvable ou n\'est pas une catégorie initiale', null, 400);
            }

            $newCategory = [
                'crop_id'           => 'pwc-' . generateUUID(),
                'name_fr'           => trim($input['name_fr']),
                'hierarchy_id_list' => $input['hierarchy_id_list'] ?? [],
                'EPPOCode'          => $input['EPPOCode'] ?? '',
                'initial_name'      => $input['initial_name'] ?? trim($input['name_fr']),
                'initial_crop_id'   => $input['initial_crop_id'],
            ];

            $categories[] = $newCategory;

            if (writeCategories($phytowebFile, $categories)) {
                sendResponse(true, 'Catégorie créée avec succès', $newCategory, 201);
            } else {
                sendResponse(false, 'Erreur lors de l\'enregistrement', null, 500);
            }

        // ── PUT ─────────────────────────────────────────────────────────────
        case 'PUT':
            $cropId = $_GET['crop_id'] ?? null;
            if (!$cropId) {
                sendResponse(false, 'Paramètre crop_id requis', null, 400);
            }

            $input = json_decode(file_get_contents('php://input'), true);

            $hasNameFr      = isset($input['name_fr']) && trim($input['name_fr']) !== '';
            $hasVisible     = array_key_exists('visible_statut', $input);

            if (!$hasNameFr && !$hasVisible) {
                sendResponse(false, 'Au moins un champ à modifier est requis (name_fr ou visible_statut)', null, 400);
            }

            $categories = readCategories($phytowebFile);
            $found      = false;

            foreach ($categories as &$cat) {
                if ($cat['crop_id'] === $cropId) {
                    $isInitiale = ($cat['crop_id'] === ($cat['initial_crop_id'] ?? $cat['crop_id']));

                    if ($isInitiale) {
                        // Pour une catégorie initiale, seul visible_statut est autorisé
                        if ($hasNameFr) {
                            sendResponse(false, 'Impossible de modifier le nom d\'une catégorie initiale', null, 403);
                        }
                        $cat['visible_statut'] = (bool) $input['visible_statut'];
                    } else {
                        // Pour une catégorie personnalisée
                        if ($hasNameFr) {
                            $cat['name_fr'] = trim($input['name_fr']);
                        }
                        if ($hasVisible) {
                            $cat['visible_statut'] = (bool) $input['visible_statut'];
                        }
                    }

                    $found = true;
                    break;
                }
            }

            if (!$found) sendResponse(false, 'Catégorie non trouvée', null, 404);

            if (writeCategories($phytowebFile, $categories)) {
                sendResponse(true, 'Catégorie modifiée avec succès');
            } else {
                sendResponse(false, 'Erreur lors de la modification', null, 500);
            }

        // ── DELETE ──────────────────────────────────────────────────────────
        case 'DELETE':
            $cropId = $_GET['crop_id'] ?? null;
            if (!$cropId) {
                sendResponse(false, 'Paramètre crop_id requis', null, 400);
            }

            $categories    = readCategories($phytowebFile);
            $found         = false;
            $newCategories = [];

            foreach ($categories as $cat) {
                if ($cat['crop_id'] === $cropId) {
                    // Refus de supprimer une catégorie initiale
                    if ($cat['crop_id'] === ($cat['initial_crop_id'] ?? $cat['crop_id'])) {
                        sendResponse(false, 'Impossible de supprimer une catégorie initiale', null, 403);
                    }
                    $found = true;
                    continue; // on ne l'ajoute pas à $newCategories
                }
                $newCategories[] = $cat;
            }

            if (!$found) sendResponse(false, 'Catégorie non trouvée', null, 404);

            if (writeCategories($phytowebFile, $newCategories)) {
                sendResponse(true, 'Catégorie supprimée avec succès');
            } else {
                sendResponse(false, 'Erreur lors de la suppression', null, 500);
            }

        default:
            sendResponse(false, 'Méthode non supportée', null, 405);
    }
} catch (Exception $e) {
    sendResponse(false, 'Erreur serveur : ' . $e->getMessage(), null, 500);
}
