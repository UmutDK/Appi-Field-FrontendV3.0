-- Base : c2544857c_appifield
-- Archivage des parcelles (même principe que crops.isArchived) et renouvellement :
--   isArchived   : 0 = active, 1 = archivée (masquée des propositions de parcelles lors de la
--                  création de cultures et de l'encodage de traitements/travaux). Défaut 0.
--   prevParcelId : pour une parcelle créée par « Archiver et renouveler », id de la parcelle
--                  archivée dont elle prend la suite (même parcelle, nouveau numéro PAC). NULL sinon.
--   sigecCode    : code SIGEC de la parcelle. Saisi dans le formulaire frontend depuis la
--                  migration du backend mais jamais persisté faute de colonne (cf.
--                  DATABASE_STRUCTURE.md) ; requis pour le renouvellement. NULL par défaut.
-- Toutes les parcelles existantes : isArchived = 0, prevParcelId = NULL, sigecCode = NULL.
-- À appliquer AVANT de déployer le backend qui l'utilise.

ALTER TABLE parcels
    ADD COLUMN isArchived TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN prevParcelId VARCHAR(255) NULL DEFAULT NULL,
    ADD COLUMN sigecCode VARCHAR(50) NULL DEFAULT NULL;
