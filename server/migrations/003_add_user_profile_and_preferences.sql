-- Base : c2544857c_appifield
-- Remplace previousServer users_infos.json (phytolicence, n° exploitant) et
-- users_pref.json (préférences d'affichage/encodage). Une ligne par utilisateur
-- (upsert), au lieu des tableaux JSON à plat de l'ancien système.
-- NB : les champs `date`/`succes` (users_infos) et `id`/`idMesPreference`/
-- `parcel_category` hardcodé (users_pref) de l'ancien système n'ont pas
-- d'équivalent ici : c'était du bruit sans usage réel côté frontend.

CREATE TABLE IF NOT EXISTS userProfile (
    userId VARCHAR(255) NOT NULL PRIMARY KEY,
    phytolicence TEXT,
    exploitingNumber TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preferences (
    userId VARCHAR(255) NOT NULL PRIMARY KEY,
    sprayerType TEXT,
    treatmentEncodingMode TEXT,
    trackFieldWorks BOOLEAN DEFAULT 0,
    trackLargeCrops BOOLEAN DEFAULT 0,
    trackMarketGardening BOOLEAN DEFAULT 0,
    trackForageCrops BOOLEAN DEFAULT 0,
    trackOrnamentalPlants BOOLEAN DEFAULT 0,
    trackArboriculture BOOLEAN DEFAULT 0,
    trackNurseriesViticultureChristmasTrees BOOLEAN DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
