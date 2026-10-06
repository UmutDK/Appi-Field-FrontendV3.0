<?php
/**
 * Import GML pour le système de parcelles
 * Convertit un fichier GML PAC en parcelles JSON et les intègre directement à exploitation/parcelles.json
 * Usage: POST avec fichier gml_file vers ce script
 */
require_once __DIR__ . '/config.php';

// Chargement de l'autoloader Composer pour proj4php
require_once __DIR__ . '/vendor/autoload.php';

use proj4php\Proj4php;
use proj4php\Proj;
use proj4php\Point;

header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
header("Cache-Control: no-cache");
header("Content-Type: application/json; charset=UTF-8");

// Gestion des requêtes preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

/**
 * Valide le token et récupère l'id_user
 */
function validateTokenAndGetUserId($token) {
    if (empty($token)) {
        error_log("🔒 Token manquant pour l'import GML");
        return null;
    }
    
    $url = USERKEY_VERIFY_URL . "?token=" . urlencode($token);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'AppiField-GML-Import/1.0');
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        error_log("🔒 Erreur cURL validation token GML: " . $error);
        return null;
    }
    
    if ($httpCode === 200 && $response) {
        $data = json_decode($response, true);
        if (json_last_error() === JSON_ERROR_NONE && isset($data['Id_User'])) {
            error_log("🔒 Token GML validé pour utilisateur: " . $data['Id_User']);
            return $data['Id_User'];
        }
    }
    
    error_log("🔒 Token GML invalide - HTTP: $httpCode");
    return null;
}

/**
 * Extrait le token depuis les headers ou paramètres
 */
function getTokenFromHeaders() {
    // Priorité aux headers Authorization
    $headers = getallheaders();
    if ($headers && isset($headers['Authorization'])) {
        $authHeader = $headers['Authorization'];
        if (strpos($authHeader, 'Bearer ') === 0) {
            return substr($authHeader, 7);
        }
    }
    
    // Fallback sur les paramètres GET/POST
    $token = $_GET['token'] ?? $_POST['token'] ?? null;
    
    // Debug: log les sources de token
    if ($token) {
        $source = isset($_POST['token']) ? 'POST' : 'GET';
        error_log("🔒 Token trouvé via $source: " . substr($token, 0, 10) . "...");
    } else {
        error_log("🔒 Aucun token trouvé dans Authorization header, GET ou POST");
        if ($headers) {
            error_log("🔒 Headers disponibles: " . implode(', ', array_keys($headers)));
        }
    }
    
    return $token;
}

class GMLToParcelImporter {
    
    private $baseDir;
    private $parcelFile;
    private $userId;
    private $proj4;
    private $projLambert72;
    private $projWGS84;
    
    public function __construct($userId = null) {
        $this->baseDir = __DIR__ . '/';
        $this->parcelFile = $this->baseDir . 'exploitation/parcels.json';
        $this->userId = $userId;
        
        // Initialisation de proj4php pour la conversion Lambert 72 → WGS84
        $this->proj4 = new Proj4php();
        
        // Définition du système Lambert 72 belge (EPSG:31370)
        $this->projLambert72 = new Proj(
            '+proj=lcc +lat_1=51.16666723333333 +lat_2=49.8333339 +lat_0=90 +lon_0=4.367486666666666 +x_0=150000.013 +y_0=5400088.438 +ellps=intl +towgs84=-106.8686,52.2978,-103.7239,0.3366,-0.457,1.8422,-1.2747 +units=m +no_defs',
            $this->proj4
        );
        
        // Définition du système WGS84 (EPSG:4326)
        $this->projWGS84 = new Proj('EPSG:4326', $this->proj4);
        
        if ($this->userId) {
            error_log("🗺️ Import GML initialisé pour utilisateur: " . $this->userId);
        } else {
            error_log("⚠️ Import GML sans utilisateur identifié");
        }
    }
    
    /**
     * Parse les coordonnées depuis une posList GML
     */
    private function parseCoordinates($posList) {
        try {
            $coords = array_map('floatval', array_filter(explode(' ', trim($posList))));
            $coordinatePairs = [];
            
            for ($i = 0; $i < count($coords); $i += 2) {
                if ($i + 1 < count($coords)) {
                    $coordinatePairs[] = [$coords[$i], $coords[$i + 1]];
                }
            }
            
            return $coordinatePairs;
        } catch (Exception $e) {
            return [];
        }
    }
    
    /**
     * Parse les coordonnées depuis un élément gml:coordinates (format V2)
     */
    private function parseGmlCoordinates($coordinatesText) {
        try {
            // Format GML coordinates: "x1,y1 x2,y2 x3,y3"
            $coordinatePairs = [];
            $pairs = explode(' ', trim($coordinatesText));
            
            foreach ($pairs as $pair) {
                $coords = explode(',', trim($pair));
                if (count($coords) >= 2) {
                    $coordinatePairs[] = [floatval($coords[0]), floatval($coords[1])];
                }
            }
            
            return $coordinatePairs;
        } catch (Exception $e) {
            return [];
        }
    }
    
    /**
     * Conversion Lambert72 vers WGS84 utilisant proj4php
     * Conversion précise utilisant les paramètres officiels EPSG:31370
     * 
     * @param float $x Coordonnée X en Lambert 72 (mètres)
     * @param float $y Coordonnée Y en Lambert 72 (mètres)
     * @return array [latitude, longitude] en WGS84
     */
    private function convertLambert72ToWgs84($x, $y) {
        try {
            // Création du point en Lambert 72
            $pointLambert = new Point($x, $y, $this->projLambert72);
            
            // Transformation vers WGS84
            $pointWGS84 = $this->proj4->transform($this->projWGS84, $pointLambert);
            
            // proj4php retourne [longitude, latitude], on inverse pour [lat, lon]
            $lon = $pointWGS84->x;
            $lat = $pointWGS84->y;
            
            return [$lat, $lon];
            
        } catch (Exception $e) {
            error_log("⚠️ Erreur conversion proj4php: " . $e->getMessage() . " - Fallback approximation");
            
            // Fallback vers l'approximation en cas d'erreur
            return $this->convertLambert72ToWgs84Fallback($x, $y);
        }
    }
    
    /**
     * Méthode de fallback pour la conversion (approximation linéaire)
     * Utilisée uniquement si proj4php échoue
     */
    private function convertLambert72ToWgs84Fallback($x, $y) {
        // Coordonnées de référence - Lobbes
        $lobbes_lat = 50.3488;
        $lobbes_lon = 4.2717;
        
        // Vraies coordonnées Lambert72 de Lobbes (EPSG:31370)
        $lobbes_lambert_x = 143093.14;
        $lobbes_lambert_y = 115320.38;
        
        // Calcul de l'offset par rapport à Lobbes
        $dx = $x - $lobbes_lambert_x;
        $dy = $y - $lobbes_lambert_y;
        
        // Conversion en degrés
        $meters_per_degree_lat = 111319.5;
        $meters_per_degree_lon = 111319.5 * cos(deg2rad($lobbes_lat));
        
        $lat = $lobbes_lat + ($dy / $meters_per_degree_lat);
        $lon = $lobbes_lon + ($dx / $meters_per_degree_lon);
        
        return [$lat, $lon];
    }
    
    /**
     * Calcule l'aire d'un polygone en hectares
     */
    private function calculatePolygonArea($coordinates) {
        if (count($coordinates) < 3) {
            return 0.0;
        }
        
        $area = 0.0;
        $n = count($coordinates);
        
        for ($i = 0; $i < $n; $i++) {
            $j = ($i + 1) % $n;
            $area += $coordinates[$i][0] * $coordinates[$j][1];
            $area -= $coordinates[$j][0] * $coordinates[$i][1];
        }
        
        $area = abs($area) / 2.0;
        $areaHectares = $area / 10000.0;
        
        return round($areaHectares, 2);
    }
    
    /**
     * Calcule le centroïde d'un polygone
     */
    private function calculateCentroid($coordinates) {
        if (empty($coordinates)) {
            return [0.0, 0.0];
        }
        
        $sumX = array_sum(array_column($coordinates, 0));
        $sumY = array_sum(array_column($coordinates, 1));
        
        return [$sumX / count($coordinates), $sumY / count($coordinates)];
    }
    
    /**
     * Génère un UUID v4
     */
    private function generateUuid() {
        return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );
    }
    
    /**
     * Trouve un élément XML avec gestion des namespaces
     */
    private function findElementWithNamespace($element, $tagName) {
        $found = $element->getElementsByTagName($tagName);
        if ($found->length > 0) {
            return $found->item(0);
        }
        return null;
    }
    
    /**
     * Détecte le format GML (V1 ou V2) basé sur les namespaces
     */
    private function detectGmlFormat($doc) {
        $xpath = new DOMXPath($doc);
        
        // Test pour format V1 (PAC)
        $xpath->registerNamespace('cap', 'http://ec.europa.eu/dgagri/cap');
        $capNodes = $xpath->query('//cap:PARCEL');
        if ($capNodes->length > 0) {
            return 'v1';
        }
        
        // Test pour format V2 (MR14)
        $xpath->registerNamespace('mr14', 'http://opw/model/gmlmr14/v1.2');
        $mr14Nodes = $xpath->query('//mr14:PARCELLE_MR14');
        if ($mr14Nodes->length > 0) {
            return 'v2';
        }
        
        // Fallback sans namespace
        $parcelNodes = $xpath->query('//PARCEL');
        if ($parcelNodes->length > 0) {
            return 'v1';
        }
        
        $parcelleNodes = $xpath->query('//PARCELLE_MR14');
        if ($parcelleNodes->length > 0) {
            return 'v2';
        }
        
        return 'unknown';
    }
    
    /**
     * Convertit un fichier GML V1 (PAC) en parcelles JSON
     */
    private function convertGmlV1ToParcels($doc, $xpath) {
        $parcels = [];
        
        // Enregistrement des namespaces pour V1
        $xpath->registerNamespace('cap', 'http://ec.europa.eu/dgagri/cap');
        $xpath->registerNamespace('gml', 'http://www.opengis.net/gml');
        
        // Recherche des parcelles avec namespace
        $parcelNodes = $xpath->query('//cap:PARCEL');
        
        if ($parcelNodes->length === 0) {
            // Fallback sans namespace
            $parcelNodes = $xpath->query('//PARCEL');
        }
        
        foreach ($parcelNodes as $parcel) {
            try {
                // Extraction des données de base
                $prcIdNodes = $xpath->query('.//PRC_ID', $parcel);
                $prcNmr = $parcel->getAttribute('PRC_NMR');
                
                $prcId = ($prcIdNodes->length > 0) ? $prcIdNodes->item(0)->textContent : 'Parcelle';
                
                // Récupération de la géométrie avec namespaces
                $geometryNodes = $xpath->query('.//cap:GEOMETRY', $parcel);
                if ($geometryNodes->length === 0) {
                    $geometryNodes = $xpath->query('.//GEOMETRY', $parcel);
                }
                
                if ($geometryNodes->length === 0) continue;
                
                $geometry = $geometryNodes->item(0);
                
                // Recherche des coordonnées dans les polygones
                $posListNodes = $xpath->query('.//gml:posList', $geometry);
                if ($posListNodes->length === 0) {
                    $posListNodes = $xpath->query('.//posList', $geometry);
                }
                
                if ($posListNodes->length === 0) continue;
                
                $posListElem = $posListNodes->item(0);
                $coordinates = $this->parseCoordinates($posListElem->textContent);
                
                if (empty($coordinates)) continue;
                
                // Calculs
                $areaHa = $this->calculatePolygonArea($coordinates);
                list($centroidX, $centroidY) = $this->calculateCentroid($coordinates);
                list($centroidLat, $centroidLon) = $this->convertLambert72ToWgs84($centroidX, $centroidY);
                
                // Extraction du type de couverture si disponible
                $typeCouvertureNodes = $xpath->query('.//TYPE_COUVERTURE', $parcel);
                $typeCouverture = ($typeCouvertureNodes->length > 0) ? $typeCouvertureNodes->item(0)->textContent : '';
                
                // Construction de la parcelle au format système
                // Éviter la répétition de 'Parcelle_' dans le nom
                $cleanPrcId = preg_replace('/^Parcelle_?/i', '', $prcId);
                $parcelData = [
                    'id_parcel' => $this->generateUuid(),
                    'parcel_name' => 'Parcelle_' . $cleanPrcId . ($prcNmr ? '_' . $prcNmr : ''),
                    'parcel_area' => (string)$areaHa,
                    'parcel_area_unit_fr' => 'ha',
                    'parcel_category' => $this->mapTypeCouverture($typeCouverture),
                    'parcel_address' => 'Parcelle GML importée',
                    'lat' => (string)round($centroidLat, 7),
                    'lon' => (string)round($centroidLon, 7),
                    'imported_from_gml' => true,
                    'record_type' => 'gml_import',
                    'import_date' => date('Y-m-d H:i:s'),
                    'gml_format' => 'v1',
                    'polygone' => json_encode(array_map(
                        fn($c) => $this->convertLambert72ToWgs84($c[0], $c[1]),
                        $coordinates
                    ))
                ];
                
                // Ajouter l'id_user si disponible
                if ($this->userId) {
                    $parcelData['id_user'] = $this->userId;
                }
                
                $parcels[] = $parcelData;
                
            } catch (Exception $e) {
                error_log("Erreur traitement parcelle V1: " . $e->getMessage());
                continue;
            }
        }
        
        return $parcels;
    }
    
    /**
     * Convertit un fichier GML V2 (MR14) en parcelles JSON
     */
    private function convertGmlV2ToParcels($doc, $xpath) {
        $parcels = [];
        // Enregistrement des namespaces pour V2
        $xpath->registerNamespace('mr14', 'http://opw/model/gmlmr14/v1.2');
        // Recherche des parcelles avec namespace
        $parcelNodes = $xpath->query('//mr14:PARCELLE_MR14');
        if ($parcelNodes->length === 0) {
            // Fallback sans namespace
            $parcelNodes = $xpath->query('//PARCELLE_MR14');
        }
    foreach ($parcelNodes as $parcel) {
            try {
                // Extraction des données de base pour MR14
                $parcelNumberNodes = $xpath->query('.//mr14:PARCELNUMBER', $parcel);
                $parcelNameNodes = $xpath->query('.//mr14:PARCELNAME', $parcel);
                $mainCropCodeNodes = $xpath->query('.//mr14:MAINCROPCODE', $parcel);
                $mainCropNameNodes = $xpath->query('.//mr14:MAINCROPNAME', $parcel);
                $declaredAreaNodes = $xpath->query('.//mr14:DECLAREDAREA', $parcel);

                // Fallback sans namespace
                if ($parcelNumberNodes->length === 0) {
                    $parcelNumberNodes = $xpath->query('.//PARCELNUMBER', $parcel);
                    $parcelNameNodes = $xpath->query('.//PARCELNAME', $parcel);
                    $mainCropCodeNodes = $xpath->query('.//MAINCROPCODE', $parcel);
                    $mainCropNameNodes = $xpath->query('.//MAINCROPNAME', $parcel);
                    $declaredAreaNodes = $xpath->query('.//DECLAREDAREA', $parcel);
                }

                $parcelNumber = ($parcelNumberNodes->length > 0) ? $parcelNumberNodes->item(0)->textContent : '';
                $parcelName = ($parcelNameNodes->length > 0) ? $parcelNameNodes->item(0)->textContent : '';
                $mainCropCode = ($mainCropCodeNodes->length > 0) ? $mainCropCodeNodes->item(0)->textContent : '';
                $mainCropName = ($mainCropNameNodes->length > 0) ? $mainCropNameNodes->item(0)->textContent : '';
                $declaredArea = ($declaredAreaNodes->length > 0) ? floatval($declaredAreaNodes->item(0)->textContent) : 0;

                // Récupération de la géométrie MR14
                $geometryNodes = $xpath->query('.//mr14:GEOMETRY', $parcel);
                if ($geometryNodes->length === 0) {
                    $geometryNodes = $xpath->query('.//GEOMETRY', $parcel);
                }

                if ($geometryNodes->length === 0) continue;

                $geometry = $geometryNodes->item(0);

                // Recherche du srsName pour savoir si Lambert72 (EPSG:31370) ou WGS84
                $polygonNodes = $geometry->getElementsByTagNameNS('http://www.opengis.net/gml', 'Polygon');
                $srsName = '';
                if ($polygonNodes->length > 0) {
                    $polygon = $polygonNodes->item(0);
                    if ($polygon->hasAttribute('srsName')) {
                        $srsName = $polygon->getAttribute('srsName');
                    }
                }

                // Recherche des coordonnées dans les polygones (format posList ou coordinates)
                $posListNodes = $xpath->query('.//gml:posList', $geometry);
                $coordinatesNodes = $xpath->query('.//gml:coordinates', $geometry);

                $coordinates = [];

                if ($posListNodes->length > 0) {
                    // Format posList
                    $posListElem = $posListNodes->item(0);
                    $coordinates = $this->parseCoordinates($posListElem->textContent);
                } elseif ($coordinatesNodes->length > 0) {
                    // Format coordinates (V2)
                    $coordinatesElem = $coordinatesNodes->item(0);
                    $coordinates = $this->parseGmlCoordinates($coordinatesElem->textContent);
                } else {
                    // Fallback sans namespace
                    $posListNodes = $xpath->query('.//posList', $geometry);
                    $coordinatesNodes = $xpath->query('.//coordinates', $geometry);

                    if ($posListNodes->length > 0) {
                        $posListElem = $posListNodes->item(0);
                        $coordinates = $this->parseCoordinates($posListElem->textContent);
                    } elseif ($coordinatesNodes->length > 0) {
                        $coordinatesElem = $coordinatesNodes->item(0);
                        $coordinates = $this->parseGmlCoordinates($coordinatesElem->textContent);
                    }
                }

                if (empty($coordinates)) continue;

                // Calculs sur les coordonnées brutes (Lambert72)
                $areaHa = $this->calculatePolygonArea($coordinates);
                list($centroidX, $centroidY) = $this->calculateCentroid($coordinates);
                
                // Conversion seulement du centre vers WGS84 (comme pour V1)
                if (stripos($srsName, '31370') !== false) {
                    list($centroidLat, $centroidLon) = $this->convertLambert72ToWgs84($centroidX, $centroidY);
                } else {
                    // Si pas Lambert72, considérer comme déjà en WGS84
                    $centroidLat = $centroidY;
                    $centroidLon = $centroidX;
                }

                // Construction de la parcelle au format système
                $displayName = $parcelName ? $parcelName : "Parcelle_$parcelNumber";
                $parcelData = [
                    'id_parcel' => $this->generateUuid(),
                    'parcel_name' => $displayName,
                    'parcel_area' => (string)$areaHa,
                    'parcel_area_unit_fr' => 'ha',
                    'parcel_category' => $this->mapMainCropToCategory($mainCropCode, $mainCropName),
                    'parcel_address' => 'Parcelle GML V2 importée',
                    'lat' => (string)round($centroidLat, 7),
                    'lon' => (string)round($centroidLon, 7),
                    'imported_from_gml' => true,
                    'record_type' => 'gml_import',
                    'import_date' => date('Y-m-d H:i:s'),
                    'gml_format' => 'v2',
                    'gml_parcel_number' => $parcelNumber,
                    'gml_main_crop_code' => $mainCropCode,
                    'gml_main_crop_name' => $mainCropName,
                    'gml_declared_area' => $declaredArea,
                    'polygone' => json_encode(array_map(
                        fn($c) => $this->convertLambert72ToWgs84($c[0], $c[1]),
                        $coordinates
                    ))
                ];

                // Ajouter l'id_user si disponible
                if ($this->userId) {
                    $parcelData['id_user'] = $this->userId;
                }

                $parcels[] = $parcelData;

            } catch (Exception $e) {
                error_log("Erreur traitement parcelle V2: " . $e->getMessage());
                continue;
            }
        }

        return $parcels;
        
        return $parcels;
    }
    
    /**
     * Map le code de culture principal MR14 vers une catégorie système
     */
    private function mapMainCropToCategory($cropCode, $cropName) {
        // Mapping basé sur les codes courants
        $mapping = [
            '610' => 'Prairie permanente',
            '311' => 'Terre arable', // Froment d'hiver
            '351' => 'Terre arable', // Triticale d'hiver
            '901' => 'Terre arable', // Pomme de terre
            '3912' => 'Terre arable', // Mélange céréales-légumineuses
        ];
        
        if (isset($mapping[$cropCode])) {
            return $mapping[$cropCode];
        }
        
        // Fallback basé sur le nom si disponible
        if (stripos($cropName, 'prairie') !== false) {
            return 'Prairie permanente';
        }
        
        return 'Plein air';
    }
    
    protected function convertGmlToParcels($gmlFilePath) {
        try {
            $doc = new DOMDocument();
            libxml_use_internal_errors(true);
            $doc->load($gmlFilePath);
            
            $xpath = new DOMXPath($doc);
            
            // Détection automatique du format
            $format = $this->detectGmlFormat($doc);
            
            error_log("🗺️ Format GML détecté: $format");
            
            switch ($format) {
                case 'v1':
                    return $this->convertGmlV1ToParcels($doc, $xpath);
                case 'v2':
                    return $this->convertGmlV2ToParcels($doc, $xpath);
                default:
                    error_log("⚠️ Format GML non reconnu");
                    return [];
            }
            
        } catch (Exception $e) {
            error_log("Erreur parsing GML: " . $e->getMessage());
            return [];
        }
    }
    
    /**
     * Map le type de couverture GML vers une catégorie système
     */
    private function mapTypeCouverture($typeCouverture) {
        $mapping = [
            'PRAIRIE_PERM_90_100' => 'Prairie permanente',
            'TERRE_ARABLE' => 'Terre arable',
            'PRAIRIE_TEMPORAIRE' => 'Prairie temporaire',
            'CULTURE_PERMANENTE' => 'Culture permanente',
            'HAIE_BDE_BOIS' => 'Haie',
            'BOSQUET' => 'Bosquet'
        ];
        
        return isset($mapping[$typeCouverture]) ? $mapping[$typeCouverture] : 'Plein air';
    }
    
    /**
     * Charge les parcelles existantes de l'utilisateur pour les statistiques uniquement
     */
    private function loadExistingUserParcelsCount() {
        try {
            $parcelsFile = $this->baseDir . 'exploitation/parcels.json';
            
            if (!file_exists($parcelsFile)) {
                return 0;
            }
            
            $content = @file_get_contents($parcelsFile);
            
            if (!$content) {
                return 0;
            }
            
            $data = json_decode($content, true);
            if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
                return 0;
            }
            
            // Compter seulement les parcelles de l'utilisateur pour les statistiques
            if ($this->userId) {
                $userParcelsCount = 0;
                foreach ($data as $parcel) {
                    if (isset($parcel['id_user']) && $parcel['id_user'] == $this->userId) {
                        $userParcelsCount++;
                    }
                }
                return $userParcelsCount;
            }
            
            return count($data);
            
        } catch (Exception $e) {
            error_log("🗺️ Erreur comptage parcelles: " . $e->getMessage());
            return 0;
        }
    }
    
    /**
     * Ajoute simplement les nouvelles parcelles au fichier local
     */
    private function addParcels($newParcels) {
        try {
            $parcelsFile = $this->baseDir . 'exploitation/parcels.json';
            $exploitationDir = $this->baseDir . 'exploitation';
            
            // Créer le dossier exploitation s'il n'existe pas
            if (!is_dir($exploitationDir)) {
                if (!mkdir($exploitationDir, 0755, true)) {
                    error_log("🗺️ Erreur création dossier exploitation");
                    return false;
                }
            }
            
            // Charger les parcelles existantes
            $existingParcels = [];
            if (file_exists($parcelsFile)) {
                $content = @file_get_contents($parcelsFile);
                if ($content) {
                    $decoded = json_decode($content, true);
                    if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                        $existingParcels = $decoded;
                    }
                }
            }
            
            // Fusionner les nouvelles parcelles avec les existantes
            $allParcels = array_merge($existingParcels, $newParcels);
            
            // Sauvegarder dans le fichier local
            $jsonData = json_encode($allParcels, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            
            if (file_put_contents($parcelsFile, $jsonData) === false) {
                error_log("🗺️ Erreur écriture fichier parcelles: " . $parcelsFile);
                return false;
            }
            
            error_log("🗺️ Ajout local réussi: " . count($newParcels) . " nouvelles parcelles ajoutées (total: " . count($allParcels) . ")");
            return true;
            
        } catch (Exception $e) {
            error_log("🗺️ Erreur ajout local: " . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Importe les parcelles GML - version simplifiée
     */
    public function importGML($gmlFilePath) {
        try {
            // 1. Conversion GML vers parcelles
            $newParcels = $this->convertGmlToParcels($gmlFilePath);
            
            if (empty($newParcels)) {
                return [
                    'success' => false,
                    'error' => 'Aucune parcelle trouvée dans le fichier GML'
                ];
            }
            
            // 2. Compter les parcelles utilisateur existantes (pour statistiques seulement)
            $existingUserParcelsCount = $this->loadExistingUserParcelsCount();
            
            // 3. Ajouter les nouvelles parcelles via l'API
            if (!$this->addParcels($newParcels)) {
                return [
                    'success' => false,
                    'error' => 'Erreur lors de l\'ajout des parcelles'
                ];
            }
            
            // 4. Construire le message de succès
            $message = 'Import GML réussi: ' . count($newParcels) . ' parcelles ajoutées';
            if ($this->userId) {
                $message .= ' pour utilisateur ' . $this->userId;
            }
            
            return [
                'success' => true,
                'message' => $message,
                'statistics' => [
                    'imported' => count($newParcels),
                    'user_parcels_before' => $existingUserParcelsCount,
                    'user_parcels_after' => $existingUserParcelsCount + count($newParcels),
                    'user_id' => $this->userId
                ],
                'parcels_preview' => array_slice($newParcels, 0, 3) // Aperçu des 3 premières parcelles
            ];
            
        } catch (Exception $e) {
            error_log("🗺️ Erreur import GML: " . $e->getMessage());
            return [
                'success' => false,
                'error' => 'Erreur lors de l\'import: ' . $e->getMessage()
            ];
        }
    }
}

// Traitement de la requête seulement si ce n'est pas un include
if (!defined('GML_IMPORT_TEST_MODE') && $_SERVER['REQUEST_METHOD'] === 'POST') {
    
    try {
        // 1. Authentification utilisateur
        $token = getTokenFromHeaders();
        $userId = validateTokenAndGetUserId($token);
        
        if (!$userId) {
            http_response_code(401);
            echo json_encode([
                'success' => false,
                'error' => 'Authentification requise - Token invalide ou manquant',
                'code' => 'UNAUTHORIZED'
            ], JSON_UNESCAPED_UNICODE);
            exit();
        }
        
        error_log("🗺️ Import GML démarré pour utilisateur: $userId");
        
        // 2. Vérification du fichier uploadé
        if (!isset($_FILES['gml_file'])) {
            throw new Exception('Aucun fichier GML fourni');
        }
        
        if ($_FILES['gml_file']['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('Erreur lors de l\'upload du fichier');
        }
        
        $uploadedFile = $_FILES['gml_file']['tmp_name'];
        $originalName = $_FILES['gml_file']['name'];
        
        // 3. Vérification extension
        $pathinfo = pathinfo($originalName);
        if (!isset($pathinfo['extension']) || strtolower($pathinfo['extension']) !== 'gml') {
            throw new Exception('Le fichier doit avoir l\'extension .gml');
        }
        
        // 4. Vérification taille
        if ($_FILES['gml_file']['size'] > 10 * 1024 * 1024) {
            throw new Exception('Le fichier est trop volumineux (max: 10 MB)');
        }
        
        // 5. Import avec utilisateur authentifié
        $importer = new GMLToParcelImporter($userId);
        $result = $importer->importGML($uploadedFile);
        
        if ($result['success']) {
            error_log("🗺️ Import GML réussi pour utilisateur $userId: " . $result['statistics']['imported'] . " parcelles");
        }
        
        echo json_encode($result, JSON_UNESCAPED_UNICODE);
        
    } catch (Exception $e) {
        error_log("🗺️ Erreur import GML: " . $e->getMessage());
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ], JSON_UNESCAPED_UNICODE);
    }
    
} elseif (!defined('GML_IMPORT_TEST_MODE')) {
    // Méthode non autorisée
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'error' => 'Seule la méthode POST est autorisée'
    ], JSON_UNESCAPED_UNICODE);
}

?>
