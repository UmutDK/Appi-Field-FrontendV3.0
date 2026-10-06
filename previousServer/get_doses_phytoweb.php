<?php
/**
 * API Doses Phytoweb - Filtrage côté serveur
 * 
 * Endpoint optimisé pour récupérer les doses recommandées
 * Filtre par product_id et cultures avec cache intelligent
 * 
 * Usage: GET /get_doses_phytoweb.php?product_id=XXX&cultures=pommiers,poiriers
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *'); // Permet toutes les origines (développement)
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Max-Age: 86400'); // Cache preflight pendant 24h

// Gestion des requêtes OPTIONS (CORS preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

try {
    // Validation des paramètres
    $product_id = $_GET['product_id'] ?? '';
    $cultures_param = $_GET['cultures'] ?? '';
    
    if (empty($product_id)) {
        throw new Exception('Paramètre product_id requis');
    }
    
    if (empty($cultures_param)) {
        throw new Exception('Paramètre cultures requis');
    }
    
    // Traitement des cultures
    $cultures = array_map('trim', explode(',', $cultures_param));
    $cultures_normalized = array_map(function($culture) {
        return strtolower(preg_replace('/\s+/', '', $culture));
    }, $cultures);
    
    // Cache intelligent basé sur la modification du fichier source
    $cache_key = md5($product_id . '_' . implode('|', array_values($cultures_normalized)));
    $cache_dir = __DIR__ . '/cache';
    $cache_file = $cache_dir . '/doses_' . $cache_key . '.json';
    $cache_duration = 3600; // 1 heure
    
    // Vérifier si le fichier source a été modifié
    $source_file = __DIR__ . '/index/doseminmax.json';
    $source_mtime = file_exists($source_file) ? filemtime($source_file) : 0;
    
    // Vérifier le cache (valide si plus récent que le fichier source ET dans la durée limite)
    if (file_exists($cache_file)) {
        $cache_mtime = filemtime($cache_file);
        $is_cache_valid = ($cache_mtime > $source_mtime) && ((time() - $cache_mtime) < $cache_duration);
        
        if ($is_cache_valid) {
            $cached_data = json_decode(file_get_contents($cache_file), true);
            if ($cached_data !== null) {
                echo json_encode([
                    'success' => true,
                    'data' => $cached_data,
                    'source' => 'cache',
                    'product_id' => $product_id,
                    'cultures' => $cultures,
                    'count' => count($cached_data),
                    'cached_at' => date('Y-m-d H:i:s', $cache_mtime)
                ]);
                exit();
            }
        }
    }
    
    //  Chargement des données source (fichier local)
    $doseminmax_file = $source_file;
    
    if (!file_exists($doseminmax_file)) {
        throw new Exception('Fichier doseminmax.json non trouvé');
    }
    
    $doseminmax_data = @file_get_contents($doseminmax_file);
    
    if ($doseminmax_data === false) {
        throw new Exception('Impossible de lire le fichier doseminmax.json');
    }
    
    $all_doses = json_decode($doseminmax_data, true);
    if ($all_doses === null) {
        throw new Exception('Erreur de parsing JSON doseminmax : ' . json_last_error_msg());
    }
    
    //  Filtrage optimisé
    $filtered_doses = [];
    
    foreach ($all_doses as $dose) {
        // Filtrer par product_id
        if ($dose['product_id'] !== $product_id) {
            continue;
        }
        
        // Filtrer par crop_name (normalisé)
        if (!empty($dose['crop_name'])) {
            $crop_normalized = strtolower(preg_replace('/\s+/', '', $dose['crop_name']));
            
            if (in_array($crop_normalized, $cultures_normalized)) {
                // 📊 Structurer la réponse
                $filtered_doses[] = [
                    'enemy_name' => $dose['enemy_name'] ?? '',
                    'target_rate_min' => $dose['target_rate_min'] ?? $dose['min_dose'] ?? '',
                    'target_rate_max' => $dose['target_rate_max'] ?? $dose['max_dose'] ?? '',
                    'target_rate_unit' => $dose['target_rate_unit'] ?? $dose['unit'] ?? '',
                    'crop_name' => $dose['crop_name'] ?? '',
                    'product_id' => $dose['product_id'] ?? ''
                ];
            }
        }
    }
    
    // 💾 Mise en cache
    $cache_dir = dirname($cache_file);
    if (!is_dir($cache_dir)) {
        mkdir($cache_dir, 0755, true);
    }
    file_put_contents($cache_file, json_encode($filtered_doses));
    
    // 📤 Réponse JSON
    $response = [
        'success' => true,
        'data' => $filtered_doses,
        'source' => 'live',
        'product_id' => $product_id,
        'cultures' => $cultures,
        'count' => count($filtered_doses),
        'total_processed' => count($all_doses),
        'processing_time' => round((microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']) * 1000, 2) . 'ms'
    ];
    
    // Debug optionnel (ajouter &debug=1 à l'URL)
    if (isset($_GET['debug'])) {
        $response['debug'] = [
            'cultures_normalized' => $cultures_normalized,
            'cache_key' => $cache_key,
            'source_file_exists' => file_exists($source_file),
            'source_file_size' => file_exists($source_file) ? filesize($source_file) : 0,
            'cache_dir_writable' => is_writable($cache_dir)
        ];
    }
    
    echo json_encode($response);
    
} catch (Exception $e) {
    // 🚨 Gestion d'erreurs
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'product_id' => $product_id ?? null,
        'cultures' => $cultures ?? null
    ]);
}

// 🧹 Nettoyage automatique du cache (optionnel)
function cleanup_old_cache_files($cache_dir, $max_age = 86400) {
    if (!is_dir($cache_dir)) return;
    
    $files = glob($cache_dir . '/doses_*.json');
    foreach ($files as $file) {
        if ((time() - filemtime($file)) > $max_age) {
            unlink($file);
        }
    }
}

// Nettoyer les fichiers de plus de 24h
cleanup_old_cache_files(__DIR__ . '/cache');
?>