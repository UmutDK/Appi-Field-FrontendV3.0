-- Base : c2544857c_appifield
-- remarks : remarque libre sur un mouvement d'inventaire (champ « Remarque » du formulaire de
-- correction de stock). Acceptée par l'API pour tous les types de mouvement, NULL si vide.
-- Toutes les lignes existantes : NULL.
-- À appliquer AVANT de déployer le backend qui l'utilise (INSERT/UPDATE dans
-- app/routes/inventories.py).

ALTER TABLE inventoriesOperations
    ADD COLUMN remarks TEXT NULL DEFAULT NULL AFTER correctionMode;
