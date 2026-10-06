<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Gérer les requêtes OPTIONS pour CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

/**
 * Script PHP pour récupérer les tuiles GeoJSON en fonction d'une position GPS
 * 
 * Paramètres d'entrée :
 * - lat : latitude de la position GPS
 * - lon : longitude de la position GPS
 * 
 * Retourne : liste des noms de fichiers GeoJSON (tuile principale + voisines)
 */

function calculateDistance($lat1, $lon1, $lat2, $lon2) {
    $earthRadius = 6371000; // Rayon de la Terre en mètres
    
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    
    $a = sin($dLat/2) * sin($dLat/2) + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon/2) * sin($dLon/2);
    $c = 2 * atan2(sqrt($a), sqrt(1-$a));
    
    return $earthRadius * $c; // Distance en mètres
}

function getTilesIndex() {
    $indexUrl = 'https://server.appifield.be/index.php?file=index/tiles_index.json';
    
    $context = stream_context_create([
        'http' => [
            'timeout' => 30,
            'method' => 'GET'
        ]
    ]);
    
    $indexData = file_get_contents($indexUrl, false, $context);
    
    if ($indexData === FALSE) {
        throw new Exception('Impossible de récupérer l\'index des tuiles');
    }
    
    $tiles = json_decode($indexData, true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new Exception('Erreur lors du décodage JSON de l\'index des tuiles');
    }
    
    return $tiles;
}

function findNearestTile($lat, $lon, $tiles) {
    $nearestTile = null;
    $minDistance = PHP_FLOAT_MAX;
    
    foreach ($tiles as $tile) {
        if (!isset($tile['center_lat']) || !isset($tile['center_lon'])) {
            continue;
        }
        
        $distance = calculateDistance($lat, $lon, $tile['center_lat'], $tile['center_lon']);
        
        if ($distance < $minDistance) {
            $minDistance = $distance;
            $nearestTile = $tile;
        }
    }
    
    return $nearestTile;
}

function find9NearestTiles($lat, $lon, $tiles) {
    $distances = [];
    
    foreach ($tiles as $tile) {
        if (!isset($tile['center_lat']) || !isset($tile['center_lon'])) {
            continue;
        }
        $distances[] = [
            'tile' => $tile,
            'distance' => calculateDistance($lat, $lon, $tile['center_lat'], $tile['center_lon'])
        ];
    }
    
    usort($distances, fn($a, $b) => $a['distance'] <=> $b['distance']);
    
    return array_slice($distances, 0, 9);
}

try {
    // Récupérer les paramètres
    $lat = isset($_GET['lat']) ? floatval($_GET['lat']) : null;
    $lon = isset($_GET['lon']) ? floatval($_GET['lon']) : null;
    
    if ($lat === null || $lon === null) {
        throw new Exception('Paramètres lat et lon requis');
    }
    
    // Validation des coordonnées
    if ($lat < -90 || $lat > 90) {
        throw new Exception('Latitude invalide (doit être entre -90 et 90)');
    }
    
    if ($lon < -180 || $lon > 180) {
        throw new Exception('Longitude invalide (doit être entre -180 et 180)');
    }
    
    // Récupérer l'index des tuiles
    $tiles = getTilesIndex();
    
    if (empty($tiles)) {
        throw new Exception('Aucune tuile trouvée dans l\'index');
    }
    
    // Trouver la tuile la plus proche et ses 8 voisines
    $nearest9 = find9NearestTiles($lat, $lon, $tiles);
    
    if (empty($nearest9)) {
        throw new Exception('Aucune tuile trouvée pour cette position');
    }
    
    $nearestTile = $nearest9[0]['tile'];
    $nearestDistance = $nearest9[0]['distance'];
    
    // Construire la liste des fichiers à retourner (tuile principale + 8 voisines)
    $tileFiles = [];
    $neighborFiles = [];
    
    foreach ($nearest9 as $entry) {
        $tileFiles[] = $entry['tile']['filename'];
        if ($entry['tile']['filename'] !== $nearestTile['filename']) {
            $neighborFiles[] = $entry['tile']['filename'];
        }
    }
    
    // Calculer la distance de la tuile la plus proche
    $distance = $nearestDistance;
    
    // Réponse JSON
    $response = [
        'success' => true,
        'input_position' => [
            'lat' => $lat,
            'lon' => $lon
        ],
        'nearest_tile' => [
            'filename' => $nearestTile['filename'],
            'center_lat' => $nearestTile['center_lat'],
            'center_lon' => $nearestTile['center_lon'],
            'distance_meters' => round($distance, 2),
            'neighbors_count' => count($neighborFiles)
        ],
        'tile_files' => $tileFiles,
        'total_tiles' => count($tileFiles),
        'base_url' => 'https://server.appifield.be/index.php?file=index/map_tiles/',
        'debug_info' => [
            'total_tiles_in_index' => count($tiles),
            'main_tile' => $nearestTile['filename'],
            'neighbors' => $neighborFiles
        ]
    ];
    
    http_response_code(200);
    echo json_encode($response, JSON_PRETTY_PRINT);
    
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'input' => [
            'lat' => $lat ?? null,
            'lon' => $lon ?? null
        ]
    ], JSON_PRETTY_PRINT);
}
?>
