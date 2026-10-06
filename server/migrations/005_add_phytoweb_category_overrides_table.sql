-- Base : c2544857c_appifield
-- Remplace previousServer/phytoweb_categories_manager.php (index/phytoweb_crops.json).
-- Ne stocke QUE la couche de surcharge admin (catégories personnalisées + visibilité
-- des catégories initiales) — pas une copie du référentiel Phytoweb lui-même, qui
-- reste en lecture seule dans c2544857c_corderPhytoweb (table `crops`, /index/phytoweb_crops).
-- Le merge {référentiel Phytoweb} + {cette table} reste à faire côté route une fois
-- les colonnes réelles de corderPhytoweb.crops connues (cf. recherche produits/doses,
-- même blocage).

CREATE TABLE IF NOT EXISTS phytowebCategoryOverrides (
    cropId VARCHAR(255) NOT NULL PRIMARY KEY,
    initialCropId VARCHAR(255) NOT NULL,
    nameFr TEXT,
    eppoCode TEXT,
    hierarchyIdList TEXT,
    visibleStatut BOOLEAN DEFAULT 1,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category_overrides_initial (initialCropId)
);
