<?php
/**
 * Fonctions de validation pour les paramètres de requête
 */

function validateRequired($params, $requiredFields) {
    $missing = [];
    foreach ($requiredFields as $field) {
        if (!isset($params[$field]) || $params[$field] === '' || $params[$field] === null) {
            $missing[] = $field;
        }
    }
    
    if (!empty($missing)) {
        sendBadRequestResponse('Paramètres manquants: ' . implode(', ', $missing));
    }
    
    return true;
}

function validateFileExists($filePath, $errorMessage = null) {
    if (!file_exists($filePath)) {
        $msg = $errorMessage ?: "Le fichier n'existe pas: " . basename($filePath);
        sendNotFoundResponse($msg);
    }
    return true;
}

function validateUserId($userId) {
    if (empty($userId) || !is_string($userId)) {
        sendBadRequestResponse('ID utilisateur invalide');
    }
    return true;
}

function validateEmail($email) {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        sendBadRequestResponse('Email invalide');
    }
    return true;
}

function validateNumeric($value, $fieldName, $min = null, $max = null) {
    if (!is_numeric($value)) {
        sendBadRequestResponse("Le champ '$fieldName' doit être numérique");
    }
    
    $numValue = floatval($value);
    
    if ($min !== null && $numValue < $min) {
        sendBadRequestResponse("Le champ '$fieldName' doit être supérieur ou égal à $min");
    }
    
    if ($max !== null && $numValue > $max) {
        sendBadRequestResponse("Le champ '$fieldName' doit être inférieur ou égal à $max");
    }
    
    return true;
}

function sanitizeString($value) {
    return htmlspecialchars(trim($value), ENT_QUOTES, 'UTF-8');
}

function sanitizeArrayOfStrings($array) {
    return array_map('sanitizeString', $array);
}
?>
