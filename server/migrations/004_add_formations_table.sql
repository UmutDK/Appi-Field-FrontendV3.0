-- Base : c2544857c_appifield
-- Remplace previousServer/formations_manager.php (formations.json, sans auth).
-- NB : les colonnes suivent le modèle Angular réel (FormationsService), pas les noms
-- formationName/formationLocation/formationDuration de DATABASE_STRUCTURE.md — cette
-- table n'était documentée qu'en spéculatif ("pas encore exposée par une route API"),
-- le vrai contrat frontend (day/month/title/location/time/link) fait foi.

CREATE TABLE IF NOT EXISTS formations (
    formationId VARCHAR(255) NOT NULL PRIMARY KEY,
    day TEXT,
    month TEXT,
    title TEXT,
    location TEXT,
    time TEXT,
    link TEXT,
    orderIndex INT DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
