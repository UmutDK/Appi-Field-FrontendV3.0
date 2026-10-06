<?php
/**
 * Fonctions utilitaires pour les réponses HTTP
 * Gestion des codes de statut, JSON, headers
 */

function sendJsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

function sendSuccessResponse($message = 'Opération réussie', $additionalData = []) {
    $response = array_merge(['success' => true, 'message' => $message], $additionalData);
    sendJsonResponse($response, 200);
}

function sendErrorResponse($message, $statusCode = 400, $additionalData = []) {
    $response = array_merge(['error' => $message], $additionalData);
    sendJsonResponse($response, $statusCode);
}

function sendNotFoundResponse($message = 'Ressource non trouvée') {
    sendErrorResponse($message, 404);
}

function sendUnauthorizedResponse($message = 'Non autorisé') {
    sendErrorResponse($message, 401);
}

function sendBadRequestResponse($message = 'Requête invalide') {
    sendErrorResponse($message, 400);
}

function sendInternalErrorResponse($message = 'Erreur interne du serveur') {
    sendErrorResponse($message, 500);
}

function getRequestParam($key, $default = null, $source = 'both') {
    if ($source === 'get' || $source === 'both') {
        if (isset($_GET[$key])) {
            return $_GET[$key];
        }
    }
    
    if ($source === 'post' || $source === 'both') {
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        if (isset($data[$key])) {
            return $data[$key];
        }
    }
    
    return $default;
}

function getMultipleRequestParams($keys, $source = 'both') {
    $params = [];
    foreach ($keys as $key) {
        $params[$key] = getRequestParam($key, null, $source);
    }
    return $params;
}

function paginateData($data, $page, $limit) {
    $total = count($data);
    $offset = $page * $limit;
    return [
        'data'  => array_values(array_slice($data, $offset, $limit)),
        'total' => $total,
        'page'  => $page,
        'limit' => $limit,
        'pages' => (int)ceil($total / max(1, $limit))
    ];
}

function sendPaginatedOrFull($data, $jsonFlags = JSON_UNESCAPED_UNICODE) {
    $paginationRequested = isset($_GET['paginated']) && $_GET['paginated'] === 'true';
    if ($paginationRequested) {
        $page  = max(0, (int)($_GET['page']  ?? 0));
        $limit = min(max(10, (int)($_GET['limit'] ?? 100)), 1000);
        echo json_encode(paginateData($data, $page, $limit), $jsonFlags);
    } else {
        echo json_encode($data, $jsonFlags);
    }
}
?>
