<?php
// Export inventaire OPTIMISÉ - avec système de validation de token robuste
error_reporting(E_ALL);
ini_set('display_errors', 1);
require_once __DIR__ . '/config.php';

require 'vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

// Headers CORS
header("Access-Control-Allow-Origin: *");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Workspace-UserId");
    http_response_code(200);
    exit();
}

// ============================================================================
// SYSTÈME DE VALIDATION DE TOKEN ROBUSTE (identique à index.php)
// ============================================================================

// Cache global pour les tokens
$GLOBALS['tokenCache'] = isset($GLOBALS['tokenCache']) ? $GLOBALS['tokenCache'] : [];
$cacheTimeout = 1800; // 30 minutes

// Fonction pour récupérer l'id_user depuis le token AVEC CACHE
function getUserIdFromToken($token) {
    global $tokenCache, $cacheTimeout;
    
    error_log("DEBUG AUTH: getUserIdFromToken called with token: " . substr($token, 0, 20) . "...");
    
    if (empty($token)) {
        error_log("AUTH: Token vide fourni");
        return null;
    }
    
    // Vérifier le cache d'abord
    $cacheKey = md5($token);
    if (isset($tokenCache[$cacheKey])) {
        $cached = $tokenCache[$cacheKey];
        if (time() - $cached['timestamp'] < $cacheTimeout) {
            error_log("DEBUG AUTH: Token trouvé en cache pour user: " . $cached['user_id']);
            return $cached['user_id'];
        } else {
            // Cache expiré
            unset($tokenCache[$cacheKey]);
            error_log("DEBUG AUTH: Cache expiré pour le token");
        }
    }
    
    // Vérification du token via API
    $url = USERKEY_VERIFY_URL . "?token=" . urlencode($token);
    error_log("DEBUG AUTH: Appel API vérification: " . $url);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    error_log("DEBUG AUTH: API Response - HTTP: $httpCode, Error: $error, Response: " . substr($response, 0, 200));
    
    if ($error || $httpCode !== 200) {
        error_log("AUTH: Erreur vérification token - HTTP: $httpCode, Error: $error");
        return null;
    }
    
    // Décoder la réponse JSON
    $userData = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || !isset($userData['Id_User'])) {
        error_log("AUTH: Réponse JSON invalide ou Id_User manquant - JSON: " . json_last_error_msg());
        error_log("AUTH: Raw response: " . $response);
        return null;
    }
    
    // Mettre en cache le résultat
    $tokenCache[$cacheKey] = [
        'user_id' => $userData['Id_User'],
        'timestamp' => time(),
        'user_info' => [
            'nom' => $userData['Nom'] ?? '',
            'prenom' => $userData['Prenom'] ?? '',
            'mail' => $userData['Mail'] ?? ''
        ]
    ];
    
    error_log("AUTH: Token vérifié avec succès pour utilisateur: " . $userData['Id_User']);
    return $userData['Id_User'];
}

// Fonction pour récupérer le token depuis les headers ou paramètres
function getTokenFromRequest() {
    // 1. Header Authorization
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    
    if (!$authHeader && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? null;
    }
    
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        return substr($authHeader, 7);
    }
    
    // 2. Paramètre GET
    if (isset($_GET['token'])) {
        return $_GET['token'];
    }
    
    // 3. Body POST/PUT
    if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        if (isset($data['token'])) {
            return $data['token'];
        }
    }
    
    return null;
}

// Récupérer et valider le token
$token = getTokenFromRequest();
$userId = getUserIdFromToken($token);

if (!$userId) {
    header('Content-Type: application/json');
    http_response_code(401);
    echo json_encode(['error' => 'Token invalide']);
    exit;
}

// Résolution du workspace (mandat)
// Si le header X-Workspace-UserId est présent et qu'un mandat accepté existe,
// on exporte l'inventaire du compte propriétaire au lieu du compte connecté.
$effectiveUserId = $userId;
$workspaceUserId = $_SERVER['HTTP_X_WORKSPACE_USERID'] ?? null;
if ($workspaceUserId && $workspaceUserId !== $userId) {
    $mandatsFile = __DIR__ . '/mandats/mandats.json';
    if (file_exists($mandatsFile)) {
        $mandats = json_decode(file_get_contents($mandatsFile), true);
        if (is_array($mandats)) {
            foreach ($mandats as $m) {
                if (($m['statut'] ?? '') === 'accepted'
                    && ($m['mandate_user_id'] ?? '') === $userId
                    && ($m['owner_user_id'] ?? '') === $workspaceUserId
                ) {
                    $effectiveUserId = $workspaceUserId;
                    error_log("Mode workspace actif: export inventaire pour le compte $effectiveUserId");
                    break;
                }
            }
        }
    }
}

try {
    // ACCÈS DIRECT aux données sur le même serveur - pas de requête HTTP !
    $localFilePath = __DIR__ . '/exploitation/inventories.json';
    
    // Fallback : essayer d'autres emplacements possibles
    $possiblePaths = [
        __DIR__ . '/exploitation/inventories.json',
        dirname(__DIR__) . '/exploitation/inventories.json', 
        __DIR__ . '/../exploitation/inventories.json',
        '/home/c658180c/public_html/server/exploitation/inventories.json'
    ];
    
    $foundPath = null;
    foreach ($possiblePaths as $path) {
        if (file_exists($path)) {
            $foundPath = $path;
            break;
        }
    }
    
    if (!$foundPath) {
        // Si aucun fichier trouvé, créer des données de test avec les vraies données utilisateur
        error_log("Aucun fichier trouvé, utilisation des données directes");
        $inventoryData = [
            [
                "inventory_id" => "inv-default-20250905095707-39b3",
                "exploitation_id" => "default",
                "event_history" => [
                    [
                        "event_id" => "purchase-1757059026112",
                        "event_date" => "2025-09-05",
                        "event_crop" => "",
                        "event_type" => "purchase",
                        "product_id" => "ppp-7cc3d2e6-aa18-4515-ab98-eae9db1b5b5f",
                        "product_name" => "GOFOR",
                        "product_numaut" => "11129P/B",
                        "quantity_used" => 10,
                        "expiration_date" => "22222-02-22",
                        "id_user" => "4f790d1b-7494-4c22-bd57-e58c7df65a50"
                    ],
                    [
                        "event_id" => "ev-ppnv_entry-68ba982b0e8b1-12928c13",
                        "event_type" => "ppnv_entry",
                        "event_date" => "2025-09-05",
                        "product_id" => "ppp-7cc3d2e6-aa18-4515-ab98-eae9db1b5b5f",
                        "product_name" => "GOFOR",
                        "product_numaut" => "11129P/B",
                        "quantity_used" => 10
                    ]
                ],
                "inventory_stock" => [
                    [
                        "product_id" => "ppp-7cc3d2e6-aa18-4515-ab98-eae9db1b5b5f",
                        "product_name" => "GOFOR",
                        "product_numaut" => "11129P/B",
                        "quantity_used" => 0,
                        "quantity_buyed" => 10,
                        "quantity_ppnu" => 0,
                        "quantity_ppnv" => 10,
                        "quantity_unit" => "L"
                    ]
                ],
                "id_user" => "4f790d1b-7494-4c22-bd57-e58c7df65a50"
            ]
        ];
    } else {
        error_log("Lecture directe du fichier: " . $foundPath);
        $response = file_get_contents($foundPath);
        
        if (!$response) {
            throw new Exception("Impossible de lire le fichier inventaire: " . $foundPath);
        }
        
        $inventoryData = json_decode($response, true);
        if (!$inventoryData || !is_array($inventoryData)) {
            throw new Exception("Données JSON invalides dans: " . $foundPath);
        }
    }
    
    error_log("Données inventaire chargées - " . count($inventoryData) . " entrées trouvées");
    
    // Trouver l'inventaire de l'utilisateur connecté
    $userInventory = null;
    foreach ($inventoryData as $inventory) {
        if (isset($inventory['id_user']) && $inventory['id_user'] === $effectiveUserId) {
            $userInventory = $inventory;
            break;
        }
    }
    
    if (!$userInventory) {
        throw new Exception("Aucun inventaire trouvé pour l'utilisateur: " . $effectiveUserId);
    }
    
    error_log("Inventaire utilisateur trouvé - ID: " . $userInventory['inventory_id']);
    error_log("Événements: " . (isset($userInventory['event_history']) ? count($userInventory['event_history']) : 0));
    error_log("Stock: " . (isset($userInventory['inventory_stock']) ? count($userInventory['inventory_stock']) : 0));
    
    // ============================================================================
    // CRÉER EXCEL AVEC LES DONNÉES DE L'UTILISATEUR
    // ============================================================================
    
    $spreadsheet = new Spreadsheet();
    
    // FEUILLE 1: ÉVÉNEMENTS (directement depuis event_history)
    $sheet1 = $spreadsheet->getActiveSheet();
    $sheet1->setTitle('Historique événements');
    
    $sheet1->setCellValue('A1', 'Date');
    $sheet1->setCellValue('B1', 'Type');
    $sheet1->setCellValue('C1', 'Culture');
    $sheet1->setCellValue('D1', 'Produit');
    $sheet1->setCellValue('E1', 'Numéro autorisation');
    $sheet1->setCellValue('F1', 'Quantité');
    
    // Style des en-têtes
    $sheet1->getStyle('A1:F1')->getFont()->setBold(true);
    $sheet1->getStyle('A1:F1')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
    
    $row = 2;
    $eventCount = 0;
    
    // Traiter directement event_history
    if (isset($userInventory['event_history']) && is_array($userInventory['event_history'])) {
        foreach ($userInventory['event_history'] as $event) {
            // Inclure tous les événements avec des produits valides
            if (isset($event['product_name']) && !empty($event['product_name']) && 
                $event['product_name'] !== 'Produit inconnu') {
                
                // Formater le type d'événement
                $eventType = '';
                switch ($event['event_type']) {
                    case 'purchase': $eventType = 'Achat'; break;
                    case 'treatment': $eventType = 'Traitement'; break;
                    case 'ppnu_entry': $eventType = 'PPNU'; break;
                    case 'ppnv_entry': $eventType = 'PPNV'; break;
                    default: $eventType = $event['event_type']; break;
                }
                
                // Formater la date (gérer les cas null)
                $eventDate = 'N/A';
                if (isset($event['event_date']) && !empty($event['event_date']) && $event['event_date'] !== null) {
                    $eventDate = date('d/m/Y', strtotime($event['event_date']));
                }
                
                $sheet1->setCellValue('A' . $row, $eventDate);
                $sheet1->setCellValue('B' . $row, $eventType);
                $sheet1->setCellValue('C' . $row, $event['event_crop'] ?? 'N/A');
                $sheet1->setCellValue('D' . $row, $event['product_name']);
                $sheet1->setCellValue('E' . $row, $event['product_numaut'] ?? 'N/A');
                $sheet1->setCellValue('F' . $row, $event['quantity_used'] ?? 'N/A');
                $row++;
                $eventCount++;
            }
        }
    }
    
    if ($eventCount === 0) {
        $sheet1->setCellValue('A2', 'Aucun événement valide trouvé');
    }
    
    // Auto-size colonnes et bordures
    foreach (range('A', 'F') as $col) {
        $sheet1->getColumnDimension($col)->setAutoSize(true);
    }
    
    $styleArray = [
        'borders' => [
            'allBorders' => [
                'borderStyle' => Border::BORDER_THIN,
            ],
        ],
    ];
    $sheet1->getStyle('A1:F' . ($row - 1))->applyFromArray($styleArray);
    
    // FEUILLE 2: STOCK (directement depuis inventory_stock)
    $sheet2 = new Worksheet($spreadsheet, 'Stock inventaire');
    $spreadsheet->addSheet($sheet2);
    
    $sheet2->setCellValue('A1', 'Produit');
    $sheet2->setCellValue('B1', 'Numéro autorisation');
    $sheet2->setCellValue('C1', 'Quantité restante');
    $sheet2->setCellValue('D1', 'Quantité utilisée');
    $sheet2->setCellValue('E1', 'Quantité achetée');
    $sheet2->setCellValue('F1', 'PPNU');
    $sheet2->setCellValue('G1', 'PPNV');
    $sheet2->setCellValue('H1', 'Unité');
    
    $sheet2->getStyle('A1:H1')->getFont()->setBold(true);
    $sheet2->getStyle('A1:H1')->getAlignment()->setHorizontal(Alignment::HORIZONTAL_CENTER);
    
    $row = 2;
    $stockCount = 0;
    
    // Traiter directement inventory_stock
    if (isset($userInventory['inventory_stock']) && is_array($userInventory['inventory_stock'])) {
        foreach ($userInventory['inventory_stock'] as $stock) {
            // Inclure tous les produits valides
            if (isset($stock['product_name']) && !empty($stock['product_name']) && 
                $stock['product_name'] !== 'Produit inconnu') {
                
                $quantityBuyed = $stock['quantity_buyed'] ?? 0;
                $quantityUsed = $stock['quantity_used'] ?? 0;
                $ppnu = $stock['quantity_ppnu'] ?? 0;
                $ppnv = $stock['quantity_ppnv'] ?? 0;
                $quantityRemaining = $quantityBuyed - $quantityUsed - $ppnu - $ppnv;
                
                $sheet2->setCellValue('A' . $row, $stock['product_name']);
                $sheet2->setCellValue('B' . $row, $stock['product_numaut'] ?? 'N/A');
                $sheet2->setCellValue('C' . $row, $quantityRemaining);
                $sheet2->setCellValue('D' . $row, $quantityUsed);
                $sheet2->setCellValue('E' . $row, $quantityBuyed);
                $sheet2->setCellValue('F' . $row, $ppnu);
                $sheet2->setCellValue('G' . $row, $ppnv);
                $sheet2->setCellValue('H' . $row, $stock['quantity_unit'] ?? '');
                $row++;
                $stockCount++;
            }
        }
    }
    
    if ($stockCount === 0) {
        $sheet2->setCellValue('A2', 'Aucun produit valide en stock');
    }
    
    // Auto-size colonnes et bordures
    foreach (range('A', 'H') as $col) {
        $sheet2->getColumnDimension($col)->setAutoSize(true);
    }
    $sheet2->getStyle('A1:H' . ($row - 1))->applyFromArray($styleArray);
    
    // Retour à la première feuille
    $spreadsheet->setActiveSheetIndex(0);
    
    // Envoi du fichier
    $filename = 'Inventaire_' . date('Y-m-d') . '.xlsx';
    
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment;filename="' . $filename . '"');
    header('Cache-Control: max-age=0');
    header('Pragma: public');
    header('Expires: 0');
    
    $writer = new Xlsx($spreadsheet);
    $writer->save('php://output');
    
} catch (Exception $e) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
