<?php
/**
 * Gestionnaire pour les produits personnalisés (engrais, autres produits non-phytoweb)
 * Stockés dans index/personnal_product.json, filtrés par user_id
 */

/**
 * Point d'entrée principal – appelé depuis index.php
 */
function handlePersonalProducts($method, $baseDir, $userId, $requestData = null) {
    $filePath = $baseDir . 'index/personnal_product.json';

    // Créer le répertoire index/ si absent
    $indexDir = $baseDir . 'index';
    if (!is_dir($indexDir)) {
        mkdir($indexDir, 0755, true);
    }

    // Lire les produits existants
    $products = readPersonalProducts($filePath);

    switch ($method) {
        case 'GET':
            // Retourner uniquement les produits de cet utilisateur
            $userProducts = array_values(array_filter($products, function ($p) use ($userId) {
                return isset($p['user_id']) && $p['user_id'] === $userId;
            }));
            sendJsonResponse($userProducts, 200);
            break;

        case 'POST':
            if (empty($requestData['product_name'])) {
                sendBadRequestResponse('Le nom du produit est obligatoire.');
            }
            $newProduct = [
                'product_id'   => 'perso-' . generatePersonalUUID(),
                'user_id'      => $userId,
                'product_name' => sanitizeInput($requestData['product_name']),
                'product_type' => sanitizeInput($requestData['product_type'] ?? 'autre'),
                'created_at'   => date('Y-m-d'),
            ];
            $products[] = $newProduct;
            writePersonalProducts($filePath, $products);
            sendJsonResponse(['success' => true, 'product' => $newProduct], 201);
            break;

        case 'PUT':
            $productId = $_GET['product_id'] ?? null;
            if (!$productId) {
                sendBadRequestResponse('ID du produit requis pour la mise à jour.');
            }
            if (empty($requestData['product_name'])) {
                sendBadRequestResponse('Le nom du produit est obligatoire.');
            }
            $updated = false;
            foreach ($products as &$p) {
                if ($p['product_id'] === $productId && $p['user_id'] === $userId) {
                    $p['product_name'] = sanitizeInput($requestData['product_name']);
                    $p['product_type'] = sanitizeInput($requestData['product_type'] ?? $p['product_type'] ?? 'autre');
                    $updated = true;
                    $updatedProduct = $p;
                    break;
                }
            }
            unset($p);
            if (!$updated) {
                sendBadRequestResponse('Produit introuvable ou non autorisé.');
            }
            writePersonalProducts($filePath, $products);
            sendJsonResponse(['success' => true, 'product' => $updatedProduct], 200);
            break;

        case 'DELETE':
            $productId = $_GET['product_id'] ?? null;
            if (!$productId) {
                sendBadRequestResponse('ID du produit requis pour la suppression.');
            }
            $filtered = array_values(array_filter($products, function ($p) use ($productId, $userId) {
                // On ne supprime que si appartient à l'utilisateur connecté
                return !($p['product_id'] === $productId && $p['user_id'] === $userId);
            }));
            writePersonalProducts($filePath, $filtered);
            sendJsonResponse(['success' => true], 200);
            break;

        default:
            sendBadRequestResponse('Méthode HTTP non supportée pour les produits personnalisés.');
    }
}

// ─────────────────────── helpers ───────────────────────

function readPersonalProducts($filePath) {
    if (!file_exists($filePath)) {
        return [];
    }
    $content = file_get_contents($filePath);
    if (trim($content) === '' || trim($content) === 'null') {
        return [];
    }
    $data = json_decode($content, true);
    return is_array($data) ? $data : [];
}

function writePersonalProducts($filePath, array $products) {
    file_put_contents($filePath, json_encode(array_values($products), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function generatePersonalUUID() {
    return sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

function sanitizeInput($value) {
    return htmlspecialchars(trim((string) $value), ENT_QUOTES, 'UTF-8');
}
