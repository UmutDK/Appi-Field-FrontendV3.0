<?php
/**
 * API de recherche optimisée pour phytoweb products
 * Utilise une base SQLite pour des recherches ultra-rapides
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400'); // Cache preflight 24h

// Gérer les requêtes OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Paramètres de recherche
$searchTerm = $_GET['q'] ?? '';
$limit = min((int)($_GET['limit'] ?? 50), 100); // Max 100 résultats
$offset = (int)($_GET['offset'] ?? 0);

// Validation
if (strlen($searchTerm) < 2) {
    echo json_encode([
        'success' => false,
        'message' => 'Le terme de recherche doit contenir au moins 2 caractères',
        'results' => [],
        'total' => 0
    ]);
    exit;
}

try {
    // Connexion à la base SQLite (créée automatiquement si n'existe pas)
    $dbPath = __DIR__ . '/cache/phytoweb_products.db';
    $db = new PDO('sqlite:' . $dbPath);
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Vérifier si la table existe et est à jour
    $needsRebuild = false;
    try {
        $stmt = $db->query("SELECT COUNT(*) FROM products LIMIT 1");
        $stmt->fetchColumn();
    } catch (Exception $e) {
        $needsRebuild = true;
    }
    
    // Reconstruire l'index si nécessaire
    if ($needsRebuild) {
        rebuildIndex($db);
    }
    
    // Préparer la recherche (insensible à la casse, recherche partielle)
    $searchPattern = '%' . strtolower($searchTerm) . '%';
    
    // Compter les résultats totaux
    $countStmt = $db->prepare("
        SELECT COUNT(*) as total 
        FROM products 
        WHERE LOWER(product_name) LIKE :search 
           OR LOWER(product_numaut) LIKE :search
    ");
    $countStmt->execute(['search' => $searchPattern]);
    $total = $countStmt->fetch(PDO::FETCH_ASSOC)['total'];
    
    // Récupérer les résultats paginés
    $stmt = $db->prepare("
        SELECT 
            product_id,
            product_name,
            product_numaut,
            product_type,
            product_status,
            user_group,
            phytoweb_crops_id,
            EPPOCode
        FROM products 
        WHERE LOWER(product_name) LIKE :search 
           OR LOWER(product_numaut) LIKE :search
        ORDER BY 
            CASE 
                WHEN product_status = 'AKK' THEN 1
                WHEN product_status = 'TOINT' THEN 2
                WHEN product_status = 'INT' THEN 3
                ELSE 4
            END,
            product_name ASC
        LIMIT :limit OFFSET :offset
    ");
    
    $stmt->bindValue(':search', $searchPattern, PDO::PARAM_STR);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    
    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Réponse
    echo json_encode([
        'success' => true,
        'results' => $results,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
        'search_term' => $searchTerm
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Erreur serveur: ' . $e->getMessage(),
        'results' => [],
        'total' => 0
    ]);
}

/**
 * Reconstruit l'index SQLite depuis le fichier JSON
 */
function rebuildIndex($db) {
    // Créer la table
    $db->exec("DROP TABLE IF EXISTS products");
    $db->exec("
        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            product_numaut TEXT NOT NULL,
            product_type TEXT,
            product_status TEXT,
            user_group TEXT,
            phytoweb_crops_id TEXT,
            EPPOCode TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ");
    
    // Créer les index pour accélérer les recherches
    $db->exec("CREATE INDEX idx_product_name ON products(product_name)");
    $db->exec("CREATE INDEX idx_product_numaut ON products(product_numaut)");
    $db->exec("CREATE INDEX idx_product_status ON products(product_status)");
    
    // Charger le fichier JSON
    $jsonFile = __DIR__ . '/../index/phytoweb_products.json';
    if (!file_exists($jsonFile)) {
        throw new Exception("Fichier phytoweb_products.json introuvable");
    }
    
    $products = json_decode(file_get_contents($jsonFile), true);
    if (!is_array($products)) {
        throw new Exception("Format JSON invalide");
    }
    
    // Insérer les produits par batch pour de meilleures performances
    $db->beginTransaction();
    $stmt = $db->prepare("
        INSERT INTO products (
            product_id, product_name, product_numaut, 
            product_type, product_status, user_group,
            phytoweb_crops_id, EPPOCode
        ) VALUES (
            :product_id, :product_name, :product_numaut,
            :product_type, :product_status, :user_group,
            :phytoweb_crops_id, :EPPOCode
        )
    ");
    
    $count = 0;
    foreach ($products as $product) {
        $stmt->execute([
            'product_id' => $product['product_id'] ?? '',
            'product_name' => $product['product_name'] ?? '',
            'product_numaut' => $product['product_numaut'] ?? '',
            'product_type' => $product['product_type'] ?? '',
            'product_status' => $product['product_status'] ?? '',
            'user_group' => $product['user_group'] ?? '',
            'phytoweb_crops_id' => $product['phytoweb_crops_id'] ?? '',
            'EPPOCode' => $product['EPPOCode'] ?? ''
        ]);
        
        $count++;
        
        // Commit par batch de 1000 pour éviter la surcharge mémoire
        if ($count % 1000 === 0) {
            $db->commit();
            $db->beginTransaction();
        }
    }
    
    $db->commit();
    
    // Optimiser la base
    $db->exec("VACUUM");
    $db->exec("ANALYZE");
}
