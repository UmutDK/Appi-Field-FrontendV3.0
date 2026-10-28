-- Base : c2544857c_appifield
-- Nouveau type de mouvement d'inventaire operationType = 'correction' (remise à zéro du
-- stock restant affiché d'un produit). La quantité reste toujours positive ; le sens est
-- porté par correctionMode : 'plus' (ajout au stock) ou 'minus' (retrait du stock).
-- NULL pour tous les autres types (purchase/ppnu/ppnv).
-- À appliquer AVANT de déployer le backend qui l'utilise (INSERT/UPDATE sur cette colonne).

ALTER TABLE inventoriesOperations ADD COLUMN correctionMode VARCHAR(10) NULL AFTER standardQuantity;
