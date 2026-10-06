<?php
/**
 * Export PDF du registre phytosanitaire
 * Génère un document PDF A4 lisible avec les traitements
 */
require_once __DIR__ . '/config.php';

require 'vendor/autoload.php';

// Configuration pour éviter les conflits de sortie
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// Headers CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");
    http_response_code(200);
    exit();
}

// Fonction de log sécurisée
function logSafe($message) {
    error_log("[EXPORT-PDF] " . $message);
}

// ============================================================================
// SYSTÈME DE VALIDATION DE TOKEN (copié de export_clean_new.php)
// ============================================================================

$GLOBALS['tokenCache'] = isset($GLOBALS['tokenCache']) ? $GLOBALS['tokenCache'] : [];
$cacheTimeout = 1800;

function getUserIdFromToken($token) {
    global $tokenCache, $cacheTimeout;
    
    if (empty($token)) {
        return null;
    }
    
    $cacheKey = md5($token);
    if (isset($tokenCache[$cacheKey])) {
        $cached = $tokenCache[$cacheKey];
        if (time() - $cached['timestamp'] < $cacheTimeout) {
            return $cached['user_id'];
        }
    }
    
    $url = USERKEY_VERIFY_URL . "?token=" . urlencode($token);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        return null;
    }
    
    $userData = json_decode($response, true);
    if (json_last_error() !== JSON_ERROR_NONE || !isset($userData['Id_User'])) {
        return null;
    }
    
    $tokenCache[$cacheKey] = [
        'user_id' => $userData['Id_User'],
        'timestamp' => time()
    ];
    
    return $userData['Id_User'];
}

function getTokenFromRequest() {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    
    if (!$authHeader && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        $authHeader = $headers['Authorization'] ?? null;
    }
    
    if ($authHeader && strpos($authHeader, 'Bearer ') === 0) {
        return substr($authHeader, 7);
    }
    
    if (isset($_GET['token'])) {
        return $_GET['token'];
    }
    
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        if (isset($data['token'])) {
            return $data['token'];
        }
    }
    
    return null;
}

// ============================================================================
// CLASSE PDF PERSONNALISÉE
// ============================================================================

class MYPDF extends TCPDF {
    
    private $userInfo = [];
    private $exportDate = '';
    
    public function setUserInfo($info) {
        $this->userInfo = $info;
    }
    
    public function setExportDate($date) {
        $this->exportDate = $date;
    }
    
    // En-tête de page
    public function Header() {
        // Logo en haut à gauche (uniquement sur la première page)
        if ($this->getPage() == 1) {
            $logoUrl = 'https://server.appifield.be/static/LogoAppifield.png';
            // Dimensions du logo: largeur 25mm, hauteur auto-proportionnelle
            $this->Image($logoUrl, 10, 8, 25, 0, 'PNG', '', 'T', false, 300, '', false, false, 0, false, false, false);
        }
        
        // Titre principal (à côté du logo)
        $this->SetXY(38, 10);
        $this->SetFont('helvetica', 'B', 16);
        $this->SetTextColor(0, 0, 0);
        $this->Cell(0, 8, 'Registre phytosanitaire', 0, 1, 'L');
        
        // Infos utilisateur (sous le titre)
        $this->SetXY(38, 18);
        $this->SetFont('helvetica', '', 9);
        $this->SetTextColor(80, 80, 80);
        $phyto = $this->userInfo['phytolicence'] ?? $this->userInfo['numeroDePhytolicence'] ?? '';
        $exploit = $this->userInfo['exploiting_number'] ?? $this->userInfo['numeroDexploitant'] ?? '';
        $this->Cell(0, 4, "Phytolicence" . ($phyto ? ": $phyto" : ""), 0, 1, 'L');
        $this->SetX(38);
        $this->Cell(0, 4, "N° d'exploitant" . ($exploit ? ": $exploit" : ""), 0, 1, 'L');
        
        $this->Ln(2);
    }
    
    // Pied de page
    public function Footer() {
        $this->SetY(-12);
        $this->SetFont('helvetica', 'I', 7);
        $this->SetTextColor(108, 117, 125);
        $this->Cell(0, 10, 'Page ' . $this->getAliasNumPage() . '/' . $this->getAliasNbPages() . ' - Généré le ' . date('d/m/Y à H:i'), 0, 0, 'C');
    }
    
    // Dessiner l'en-tête du tableau
    public function drawTableHeader() {
        $this->SetY(32);
        $this->SetFont('helvetica', 'B', 6);
        $this->SetTextColor(0, 0, 0);
        $this->SetFillColor(240, 240, 240);
        $this->SetDrawColor(200, 200, 200);
        $this->SetLineWidth(0.2);
        
        // Définir le padding interne des cellules d'en-tête (gauche, haut, droite, bas)
        $this->setCellPaddings(1.5, 1.5, 1.5, 1.5);
        
        // Colonnes avec leurs largeurs (total = 277mm pour A4 paysage avec marges)
        $cols = [
            ['label' => 'Année', 'width' => 10],
            ['label' => 'Date', 'width' => 14],
            ['label' => 'Culture ou espèce emblavée', 'width' => 28],
            ['label' => 'Catégorie Phytoweb', 'width' => 25],
            ['label' => 'Stade BBCH', 'width' => 18],
            ['label' => 'Parcelle (localisation)', 'width' => 22],
            ['label' => 'Type de traitement', 'width' => 18],
            ['label' => 'Produit', 'width' => 20],
            ['label' => 'Numéro d\'autorisation', 'width' => 18],
            ['label' => 'Cible', 'width' => 46],
            ['label' => 'Surface traitée', 'width' => 14],
            ['label' => 'Quantité produit', 'width' => 14],
            ['label' => 'Dose', 'width' => 14],
            ['label' => 'Heure', 'width' => 16],
        ];
        
        $x = 10;
        $h = 8;
        
        foreach ($cols as $col) {
            $this->SetXY($x, 32);
            $this->MultiCell($col['width'], $h, $col['label'], 1, 'L', true, 0);
            $x += $col['width'];
        }
        
        $this->Ln($h);
    }
}

// ============================================================================
// FONCTION POUR DESSINER UNE LIGNE DU TABLEAU
// ============================================================================

function drawTableRow($pdf, $data, $isAlternate = false) {
    // Largeurs des colonnes (identiques à l'en-tête)
    $colWidths = [10, 14, 28, 25, 18, 22, 18, 20, 18, 46, 14, 14, 14, 16];
    
    $pdf->SetFont('helvetica', '', 5.5);
    $pdf->SetTextColor(30, 30, 30);
    $pdf->SetDrawColor(200, 200, 200);
    $pdf->SetLineWidth(0.1);
    
    // Définir le padding interne des cellules (gauche, haut, droite, bas)
    $pdf->setCellPaddings(1.5, 1.5, 1.5, 1.5);
    
    // Couleur alternée
    if ($isAlternate) {
        $pdf->SetFillColor(248, 248, 248);
    } else {
        $pdf->SetFillColor(255, 255, 255);
    }
    
    $x = 10;
    $y = $pdf->GetY();
    $minH = 5; // Hauteur minimale de ligne
    
    // Calculer la hauteur nécessaire pour chaque cellule
    $maxH = $minH;
    foreach ($data as $i => $value) {
        // Calculer le nombre de lignes nécessaires
        $cellWidth = $colWidths[$i] - 1; // Marge interne
        $numLines = $pdf->getNumLines($value, $cellWidth);
        $cellH = max($minH, $numLines * 3.5); // 3.5mm par ligne de texte
        if ($cellH > $maxH) {
            $maxH = $cellH;
        }
    }
    
    // Vérifier s'il faut une nouvelle page
    if ($y + $maxH > 200) {
        $pdf->AddPage();
        $pdf->drawTableHeader();
        $y = $pdf->GetY();
    }
    
    // Dessiner chaque cellule avec la hauteur maximale
    foreach ($data as $i => $value) {
        $pdf->SetXY($x, $y);
        // Utiliser MultiCell pour permettre le retour à la ligne - alignement haut gauche
        $pdf->MultiCell($colWidths[$i], $maxH, $value, 1, 'L', true, 0, $x, $y, true, 0, false, true, $maxH, 'T');
        $x += $colWidths[$i];
    }
    
    $pdf->SetY($y + $maxH);
}

// ============================================================================
// TRAITEMENT PRINCIPAL
// ============================================================================

try {
    logSafe("Export PDF démarré - Timestamp: " . time());
    
    // Validation du token
    $token = getTokenFromRequest();
    if (!$token) {
        throw new Exception('Token manquant');
    }
    
    $userId = getUserIdFromToken($token);
    if (!$userId) {
        throw new Exception('Token invalide');
    }
    
    logSafe("Utilisateur authentifié: $userId");
    
    // Récupération des filtres
    $input = file_get_contents('php://input');
    $requestData = json_decode($input, true);
    $filters = isset($requestData['filters']) ? $requestData['filters'] : [];
    
    $filterYears = isset($filters['years']) && is_array($filters['years']) ? $filters['years'] : [];
    $filterCropNames = isset($filters['cropNames']) && is_array($filters['cropNames']) ? $filters['cropNames'] : [];
    $filterArchiveStatus = isset($filters['archiveStatus']) ? $filters['archiveStatus'] : 'all';
    $filterParcels = isset($filters['parcels']) && is_array($filters['parcels']) ? $filters['parcels'] : [];
    
    logSafe("Filtres PDF - Années: " . implode(',', $filterYears) . 
            ", Cultures: " . implode(',', $filterCropNames) . 
            ", Archive: $filterArchiveStatus" .
            ", Parcelles: " . implode(',', $filterParcels));
    
    // Récupération des données locales
    function fetchLocalJson($relativePath, $fallback = []) {
        $fullPath = __DIR__ . '/' . $relativePath;
        if (file_exists($fullPath)) {
            $content = file_get_contents($fullPath);
            $data = json_decode($content, true);
            if (is_array($data)) {
                return $data;
            }
        }
        return $fallback;
    }
    
    $traitements = fetchLocalJson('events/phyto_treatments_final.json', []);
    $users = fetchLocalJson('users_infos.json', []);
    $parcels = fetchLocalJson('exploitation/parcels.json', []);
    
    // Filtrer pour l'utilisateur
    $userTraitements = array_filter($traitements, function($t) use ($userId) {
        return isset($t['id_user']) && $t['id_user'] === $userId;
    });
    
    // Récupérer les infos utilisateur
    $userInfo = ['phytolicence' => 'N/A', 'exploiting_number' => 'N/A'];
    foreach ($users as $user) {
        if (isset($user['id_user']) && $user['id_user'] === $userId) {
            $userInfo = $user;
            break;
        }
    }
    
    logSafe("Génération PDF - Traitements utilisateur: " . count($userTraitements));
    
    // Créer le PDF en mode PAYSAGE (L = Landscape)
    $pdf = new MYPDF('L', 'mm', 'A4', true, 'UTF-8', false);
    $pdf->setUserInfo($userInfo);
    $pdf->setExportDate(date('d/m/Y'));
    
    // Métadonnées
    $pdf->SetCreator('Appi\'Field');
    $pdf->SetAuthor('Registre Phytosanitaire');
    $pdf->SetTitle('Export Registre Phytosanitaire');
    $pdf->SetSubject('Traitements phytosanitaires');
    
    // Marges réduites pour maximiser l'espace du tableau
    $pdf->SetMargins(10, 30, 10);
    $pdf->SetHeaderMargin(5);
    $pdf->SetFooterMargin(8);
    $pdf->SetAutoPageBreak(true, 15);
    
    // Première page
    $pdf->AddPage();
    
    // Dessiner l'en-tête du tableau
    $pdf->drawTableHeader();
    
    // Compteur pour les filtres et alternance
    $filteredCount = 0;
    
    // Collecter toutes les lignes
    $rows = [];
    
    if (!empty($userTraitements)) {
        foreach ($userTraitements as $traitement) {
            $annee = isset($traitement['date']) ? date('Y', strtotime($traitement['date'])) :
                     (isset($traitement['event_date']) ? date('Y', strtotime($traitement['event_date'])) : date('Y'));

            // Filtre par année
            if (!empty($filterYears) && !in_array($annee, $filterYears)) {
                continue;
            }

            $eventType = $traitement['type'] ?? '';

            // Parcourir les compositions de traitement (comme dans export Excel)
            $composition = $traitement['treatment_composition'] ?? [];
            if (isset($composition[0]) && is_array($composition[0]) && isset($composition[0][0])) {
                $composition = $composition[0];
            }
            if (is_array($composition)) {
                foreach ($composition as $component) {
                    if (!is_array($component)) continue;
                    // Parcourir les parcelles concernées
                    $parcels_concerned = $traitement['parcels_concerned'] ?? [];
                    if (isset($parcels_concerned[0]) && is_array($parcels_concerned[0]) && isset($parcels_concerned[0][0])) {
                        $parcels_concerned = $parcels_concerned[0];
                    }
                    if (is_array($parcels_concerned)) {
                        foreach ($parcels_concerned as $parcel) {
                            if (!is_array($parcel)) continue;
                            // Filtre par culture
                            if (!empty($filterCropNames)) {
                                $cropName = $parcel['crop_name'] ?? '';
                                if (!in_array($cropName, $filterCropNames)) {
                                    continue;
                                }
                            }

                            // Filtre par statut d'archivage
                            $isArchived = ($parcel['is_archived'] ?? $parcel['isArchived'] ?? false) === true;
                            if ($filterArchiveStatus === 'archived' && !$isArchived) {
                                continue;
                            }
                            if ($filterArchiveStatus === 'not-archived' && $isArchived) {
                                continue;
                            }

                            // Filtre par parcelle
                            if (!empty($filterParcels)) {
                                $parcelName = $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? '';
                                if (!in_array($parcelName, $filterParcels)) {
                                    continue;
                                }
                            }

                            // Trouver les infos de la parcelle
                            $parcelInfo = null;
                            $parcelId = $parcel['parcel_id'] ?? $parcel['parcels_id'] ?? null;
                            if ($parcelId) {
                                foreach ($parcels as $p) {
                                    if ((isset($p['id_parcel']) && $p['id_parcel'] == $parcelId) ||
                                        (isset($p['place_id']) && $p['place_id'] == $parcelId)) {
                                        $parcelInfo = $p;
                                        break;
                                    }
                                }
                            }

                            // Calculer quantité de produit (même logique que Excel)
                            $qt_total_traitement = str_replace(',', '.', $parcel['treatment_volume_applied'] ?? '');
                            $qt_total_unite = $parcel['treatment_volume_applied_unit'] ?? 'L';
                            $qt_produit = '';
                            $std_dose = str_replace(',', '.', $component['standard_component_dose'] ?? null);
                            $std_surface = str_replace(',', '.', $parcel['standard_surface_treated'] ?? null);

                            if ($eventType === 'phyto_porridge_treatment' && is_numeric($qt_total_traitement) && is_numeric($std_dose)) {
                                $qt_produit = floatval($qt_total_traitement) * (floatval($std_dose) / 100);
                            } elseif ($eventType === 'phyto_surface_treatment' && is_numeric($std_dose) && is_numeric($std_surface)) {
                                $qt_produit = floatval($std_dose) * floatval($std_surface);
                            } else {
                                $qt_produit = $qt_total_traitement;
                            }
                            $qt_produit_unite = $component['component_quantity_unity'] ?? 'L';

                            // Extraire les données pour la ligne
                            $dateVal = $traitement['date'] ?? $traitement['event_date'] ?? null;
                            $date = $dateVal ? date('d/m/Y', strtotime($dateVal)) : '-';
                            $culture = $parcel['crop_name'] ?? '-';
                            $catPhytoweb = $parcel['phytoweb_name'] ?? $parcel['nomPhytoweb_crops_id'] ?? '-';
                            $stade = $traitement['bbch'] ?? '-';

                            // Parcelle avec coordonnées
                            $parcelleNom = $parcel['parcel_name'] ?? $parcel['parcels_name'] ?? '-';
                            $coordonnees = '';
                            if ($parcelInfo && isset($parcelInfo['lat']) && isset($parcelInfo['lon'])) {
                                $coordonnees = $parcelInfo['lat'] . '+' . $parcelInfo['lon'];
                            }
                            $parcelle = $parcelleNom . ($coordonnees ? "\n(" . $coordonnees . ")" : '');

                            $typeTraitement = 'Traitement de surface';
                            $produit = $component['component_name'] ?? '-';
                            $numAutorisation = $component['component_numaut'] ?? '-';
                            $cible = $traitement['target'] ?? ($traitement['treatment_composition'][0]['target'] ?? $traitement['ciblee'] ?? '-');

                            $surface = $parcel['parcel_surface_treated'] ?? '-';
                            $surfaceUnit = $parcel['surface_unit'] ?? 'ha';
                            $surfaceStr = $surface !== '-' && $surface !== '' ? "$surface $surfaceUnit" : '-';

                            $quantiteStr = $qt_total_traitement !== '' ? "$qt_total_traitement $qt_total_unite" : '-';

                            $dose = $component['component_dose'] ?? '-';
                            $doseUnit = $component['component_dose_unit'] ?? '';
                            $doseStr = $dose !== '-' && $dose !== '' ? "$dose $doseUnit" : '-';

                            $heure = $traitement['event_hour'] ?? '-';

                            $rows[] = [
                                $annee,
                                $date,
                                $culture,
                                $catPhytoweb,
                                $stade,
                                $parcelle,
                                $typeTraitement,
                                $produit,
                                $numAutorisation,
                                $cible,
                                $surfaceStr,
                                $quantiteStr,
                                $doseStr,
                                $heure
                            ];
                            $filteredCount++;
                        }
                    }
                }
            }
        }
    }
    
    // Dessiner toutes les lignes
    foreach ($rows as $i => $row) {
        drawTableRow($pdf, $row, $i % 2 === 1);
    }
    
    // Message si aucun résultat
    if ($filteredCount === 0) {
        $pdf->SetFont('helvetica', '', 10);
        $pdf->SetTextColor(108, 117, 125);
        $pdf->Ln(10);
        $pdf->Cell(0, 10, 'Aucun traitement ne correspond aux critères sélectionnés.', 0, 1, 'C');
    }
    
    logSafe("PDF créé - $filteredCount traitements");
    
    // Nettoyage de la sortie
    if (ob_get_level()) {
        ob_clean();
    }
    
    // Nom du fichier
    $hasFilters = !empty($filterYears) || !empty($filterCropNames) || $filterArchiveStatus !== 'all' || !empty($filterParcels);
    $filename = 'Registre_' . ($hasFilters ? 'filtre_' : '') . date('Y-m-d') . '.pdf';
    
    // Headers
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment;filename="' . $filename . '"');
    header('Cache-Control: max-age=0');
    header('Pragma: public');
    header('Expires: 0');
    
    // Sortie du PDF
    $pdf->Output($filename, 'D');
    
    logSafe("Fichier PDF envoyé: $filename");

} catch (Exception $e) {
    logSafe("ERREUR PDF: " . $e->getMessage());
    
    if (ob_get_level()) {
        ob_clean();
    }
    
    header('Access-Control-Allow-Origin: *');
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'Erreur génération PDF: ' . $e->getMessage()]);
}
?>
