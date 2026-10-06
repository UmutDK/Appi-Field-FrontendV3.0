-- Base : c2544857c_appifield
-- Table d'allowlist des utilisateurs admin, remplace l'ancien contrôle 100% frontend
-- (comparaison à des valeurs codées en dur dans le bundle JS, cf. admin.service.ts).
-- Présence d'une ligne = admin. Pas de colonne booléenne : plus simple à auditer/révoquer.

CREATE TABLE IF NOT EXISTS admins (
    userId VARCHAR(255) NOT NULL PRIMARY KEY,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
