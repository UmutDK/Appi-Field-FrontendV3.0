-- Base : c2544857c_appifield
-- Mandats / délégation : un utilisateur (owner) autorise un autre utilisateur
-- (mandataire, identifié par email tant qu'il n'est pas résolu) à agir sur ses données
-- via le header X-Workspace-UserId. Remplace previousServer/mandats_handler.php
-- (qui stockait ça dans un fichier mandats.json).

CREATE TABLE IF NOT EXISTS mandates (
    mandateId VARCHAR(255) NOT NULL PRIMARY KEY,
    mandateName TEXT,
    ownerUserId VARCHAR(255) NOT NULL,
    ownerUserMail VARCHAR(255),
    mandateUserId VARCHAR(255) NULL,
    mandateUserMail VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_mandates_owner (ownerUserId),
    INDEX idx_mandates_mandate_user (mandateUserId),
    INDEX idx_mandates_mandate_mail (mandateUserMail)
);
