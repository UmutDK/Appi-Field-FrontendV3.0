-- =============================================================================
-- 000_local_dev_schema.sql
-- =============================================================================
-- BEST-EFFORT reconstruction of the `c2544857c_appifield` schema for LOCAL
-- DEVELOPMENT ONLY.
--
-- WHY THIS FILE EXISTS
-- ---------------------
-- The real production MySQL host (91.234.194.249) is currently unreachable
-- from this machine (network/firewall issue, unrelated to application code).
-- There is no init/bootstrap script in this repo that creates the schema from
-- scratch (`database/init_first_db.py`, referenced by server/app/DATABASE_STRUCTURE.md,
-- is not present in this checkout) -- only prose documentation
-- (server/app/API_DOCUMENTATION.md, server/README.md, server/app/DATABASE_STRUCTURE.md)
-- and 10 incremental migration files (server/migrations/001..010) exist.
--
-- This file synthesizes all of the above, cross-checked against the actual
-- `INSERT`/`SELECT`/`UPDATE` statements executed in server/app/routes/*.py
-- (the most authoritative source, since it's what the running code actually
-- depends on), into a single runnable script that creates every table needed
-- to run the API locally end to end.
--
-- THIS IS NOT AN AUTHORITATIVE DUMP. It must be reconciled against the real
-- database once network access to 91.234.194.249 is restored -- in particular:
--   * exact column types (VARCHAR length, TEXT vs VARCHAR, DOUBLE vs DECIMAL)
--     are best-effort where prose docs only said "string"/"number"/"boolean";
--   * no FOREIGN KEY constraints are declared (matching the project's own
--     documented convention -- see server/app/DATABASE_STRUCTURE.md
--     "Relations entre tables": "Aucune contrainte FOREIGN KEY n'est déclarée
--     en base ... les relations sont logiques" -- so this is not a gap
--     introduced by this script, it mirrors production intentionally);
--   * the `unitsIndex` table (see big note below) is normally NOT part of
--     `c2544857c_appifield` at all -- it lives in the separate
--     `c2544857c_corderPhytoweb` database. It is duplicated here purely so a
--     single local MySQL schema can satisfy unit-resolution logic
--     (app/utils/units.py) without standing up a second database.
--
-- SCOPE
-- -----
-- Only `c2544857c_appifield` (the application data) is covered, as requested.
-- `c2544857c_corderPhytoweb` (external, read-mostly Phytoweb product/dose/crop
-- reference data, fed by an external ETL pipeline) is intentionally NOT
-- reproduced here (products, indexCrop, indexTarget, dosesMinMax, general,
-- targets, dates, etc.) -- it is out of scope for local dev of core features,
-- per the task. The one exception is `unitsIndex`, included as explained above
-- because core write paths (parcels/crops/phyto_treatments/field_works/
-- inventories) hard-depend on resolving unit names against it at write time,
-- and would otherwise silently fall back to "unresolved unit" behavior
-- (app/utils/units.py::resolve_and_standardize returns the raw name and
-- unconverted value when the unit can't be found) for every single write.
--
-- IMPORTANT FOR LOCAL SETUP: since app/db.py opens two separate connections
-- (DB_APPIFIELD and DB_PHYTOWEB env vars), for `unitsIndex` lookups to work
-- against the copy created below, point BOTH env vars at this same local
-- database for local dev (e.g. DB_APPIFIELD=appifield_local,
-- DB_PHYTOWEB=appifield_local), or create the same `unitsIndex` table again
-- under whatever second local database name you use for DB_PHYTOWEB.
--
-- CONVENTIONS USED
-- ----------------
-- * `CREATE TABLE IF NOT EXISTS` throughout, so this script is safe to re-run.
-- * ENGINE=InnoDB, DEFAULT CHARSET=utf8mb4, COLLATE=utf8mb4_unicode_ci on every
--   table. NOTE: none of the 10 existing migration files explicitly declare an
--   engine/charset (they rely on server/database defaults) -- this script adds
--   them explicitly per the task's request for MySQL-compatible utf8mb4/InnoDB
--   syntax; adjust/remove if your local MySQL server's defaults already match
--   and you'd rather match the migrations byte-for-byte.
-- * No `FOREIGN KEY` constraints -- only plain `KEY idx_*` indexes on columns
--   that are used as logical foreign keys in the application code (userId
--   everywhere for per-user isolation, plus the various `eventId`/`cropId`/
--   `parcelId`/`productId`-style join columns). This matches the project's own
--   documented "no FK, app-level integrity only" convention and avoids
--   insert-order headaches when seeding dev data.
-- * Confidence is flagged per table group in the comments below:
--     [MIGRATION]     = copied verbatim (or with a verbatim ALTER folded in)
--                        from an authoritative server/migrations/*.sql file.
--                        Highest confidence.
--     [ROUTES+DOCS]   = column list/order/types confirmed against the exact
--                        SQL executed in server/app/routes/*.py, cross-checked
--                        with server/app/DATABASE_STRUCTURE.md and
--                        server/app/API_DOCUMENTATION.md. High confidence.
--     [DOCS-ONLY]     = reconstructed from prose documentation only, no
--                        matching migration or executable SQL found. Lower
--                        confidence -- flagged explicitly at point of use.
--     [SPECULATIVE]   = not found in any source; included only for
--                        completeness/local-dev convenience. Lowest
--                        confidence -- flagged explicitly at point of use.
-- =============================================================================


-- =============================================================================
-- unitsIndex  [ROUTES+DOCS, seed values MOSTLY MIGRATION-derived]
-- =============================================================================
-- In production this table lives in `c2544857c_corderPhytoweb`, NOT in
-- `c2544857c_appifield` (confirmed by server/app/utils/units.py, which queries
-- it via `cursor_phytoweb()`, and by server/migrations/010_fix_unitsindex_bouillie_units.sql,
-- whose header explicitly calls writing to it "exceptionnellement une écriture
-- sur cette base [c2544857c_corderPhytoweb]"). It is reproduced here anyway
-- (see big note at top of file) because parcels/crops/phyto_treatments/
-- field_works/inventories all resolve unit names against it at write time via
-- app/utils/units.py::resolve_and_standardize, and the calculation engine
-- (app/utils/treatment_calc/) depends entirely on normalisationFactor being
-- correct.
--
-- idUnit is a string, not an autoincrement int: production code generates it
-- as `CONCAT('unit_', UUID())` (see migration 010's INSERT for 'g'). Matching
-- against unitName is always done case-insensitively via LOWER() comparison
-- in Python (app/utils/units.py), so exact casing of unitName below does not
-- have to match the frontend's casing byte-for-byte, only case-insensitively.
CREATE TABLE IF NOT EXISTS unitsIndex (
    idUnit VARCHAR(255) NOT NULL PRIMARY KEY,
    unitName VARCHAR(255) NOT NULL,
    normalisationFactor DOUBLE NOT NULL,
    UNIQUE KEY uq_units_name (unitName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed data (INSERT IGNORE against the UNIQUE KEY on unitName, so re-running
-- this script is safe and never duplicates rows). Factors marked HIGH
-- CONFIDENCE come directly from API_DOCUMENTATION.md's worked example or from
-- the explicit anchors/fixes documented in migrations/010_fix_unitsindex_bouillie_units.sql.
-- Factors marked SPECULATIVE were not found anywhere in the repo and are
-- included only so common local-dev scenarios (e.g. entering a parcel area in
-- m2) do not silently fail to standardize -- verify/replace against the real DB.
INSERT IGNORE INTO unitsIndex (idUnit, unitName, normalisationFactor) VALUES
    ('unit_ha',      'ha',       1.0),      -- HIGH CONFIDENCE: API_DOCUMENTATION.md example
    ('unit_l',       'L',        1.0),      -- HIGH CONFIDENCE: API_DOCUMENTATION.md example
    ('unit_l_ha',    'L/ha',     1.0),      -- HIGH CONFIDENCE: API_DOCUMENTATION.md example
    ('unit_kg',      'kg',       1.0),      -- HIGH CONFIDENCE: base mass unit implied by kg/ha=1.0 anchor (migration 010) + g=0.001 anchor
    ('unit_kg_ha',   'kg/ha',    1.0),      -- HIGH CONFIDENCE: explicit anchor in migration 010 comment ("kg/ha=1.0")
    ('unit_g',       'g',        0.001),    -- HIGH CONFIDENCE: migration 010, INSERT'ed verbatim (grams was missing entirely in prod)
    ('unit_g_ha',    'g/ha',     0.001),    -- HIGH CONFIDENCE: migration 010 comment states this unit already exists in prod with this factor
    ('unit_l_100l',  'l/100 l',  0.01),     -- HIGH CONFIDENCE: migration 010 comment, "ancrage non ambigu, fiable"
    ('unit_kg_100l', 'kg/100L',  0.01),     -- HIGH CONFIDENCE: migration 010 fix (corrected from buggy 100.0)
    ('unit_g_100l',  'g/100 l',  0.00001),  -- HIGH CONFIDENCE: migration 010 fix (corrected from buggy 0.001)
    ('unit_ml_100l', 'ml/100 l', 0.00001),  -- HIGH CONFIDENCE: migration 010 fix (corrected from buggy 0.0001)
    ('unit_l_10l',   'l/10l',    0.1),      -- HIGH CONFIDENCE: migration 010 fix (corrected from buggy 10.0)
    ('unit_m2',      'm2',       0.0001),   -- SPECULATIVE: not found in any source; 1 m2 = 0.0001 ha, included for completeness only
    ('unit_kg_l',    'kg/l',     1.0),      -- SPECULATIVE: not found in any source; included as a plausible density-adjacent unit only
    ('unit_are',     'are',      0.01);     -- SPECULATIVE: not found in any source; 1 are = 0.01 ha (surface.py docstring mentions "ha/are/m2" as dose bases)


-- =============================================================================
-- exploitations  [ROUTES+DOCS]
-- =============================================================================
-- Columns/order confirmed against the INSERT in server/app/routes/exploitations.py
-- and server/app/DATABASE_STRUCTURE.md.
CREATE TABLE IF NOT EXISTS exploitations (
    exploitationId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    exploitationName TEXT,
    exploitationAddress TEXT,
    exploitationPostalCode VARCHAR(20),
    vatNumber VARCHAR(50),
    responsibleName VARCHAR(255),
    responsibleMail VARCHAR(255),
    responsiblePhytolicence VARCHAR(255),
    exploitationPhytolicence VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_exploitations_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- parcels  [ROUTES+DOCS]
-- =============================================================================
-- Columns/order confirmed against server/app/routes/parcels.py (_insert_parcel)
-- and server/app/DATABASE_STRUCTURE.md. `parcelAreaUnitId` documented as TEXT
-- in DATABASE_STRUCTURE.md; stored here as VARCHAR(255) instead so it can carry
-- an index (values are short unit ids, never long free text).
CREATE TABLE IF NOT EXISTS parcels (
    parcelId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    parcelName VARCHAR(255),
    parcelArea DOUBLE,
    parcelAreaUnitId VARCHAR(255),
    standardParcelArea DOUBLE,
    latitude DOUBLE,
    longitude DOUBLE,
    polygon TEXT,
    parcelCategory VARCHAR(255),
    parcelAddress TEXT,
    recordType VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    isArchived TINYINT(1) NOT NULL DEFAULT 0,
    prevParcelId VARCHAR(255) NULL DEFAULT NULL,
    sigecCode VARCHAR(50) NULL DEFAULT NULL,
    KEY idx_parcels_user (userId),
    KEY idx_parcels_area_unit (parcelAreaUnitId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- operators  [ROUTES+DOCS]
-- =============================================================================
CREATE TABLE IF NOT EXISTS operators (
    operatorId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    operatorName VARCHAR(255),
    operatorPhytolicence VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_operators_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- crops  [ROUTES+DOCS, previousCrop column MIGRATION-confirmed]
-- =============================================================================
-- Base columns confirmed against server/app/routes/crops.py (create_crop INSERT)
-- and server/app/DATABASE_STRUCTURE.md. `previousCrop` (VARCHAR(255), placed
-- right after sowingDate) folded in verbatim from
-- server/migrations/008_add_crops_previous_crop.sql, which originally added it
-- via ALTER TABLE.
CREATE TABLE IF NOT EXISTS crops (
    cropId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    cropName VARCHAR(255),
    remarks TEXT,
    sowingDate DATE,
    previousCrop VARCHAR(255),
    harvestDate DATE,
    efficiency VARCHAR(255),
    collection VARCHAR(255),
    phytowebId VARCHAR(255),
    eppo VARCHAR(255),
    isArchived BOOLEAN DEFAULT 0,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crops_user (userId),
    KEY idx_crops_archived (isArchived),
    KEY idx_crops_phytoweb (phytowebId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- cropsParcels  [ROUTES+DOCS]
-- =============================================================================
-- N-N link table between crops and parcels. Columns confirmed against
-- server/app/routes/crops.py INSERT INTO cropsParcels statements.
CREATE TABLE IF NOT EXISTS cropsParcels (
    cropParcelId VARCHAR(255) NOT NULL PRIMARY KEY,
    cropId VARCHAR(255) NOT NULL,
    userId VARCHAR(255) NOT NULL,
    parcelId VARCHAR(255) NOT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_cropsparcels_crop (cropId),
    KEY idx_cropsparcels_parcel (parcelId),
    KEY idx_cropsparcels_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- phytoTreatments  [ROUTES+DOCS, totals unit/standard columns MIGRATION-confirmed]
-- =============================================================================
-- Base columns confirmed against server/app/routes/phyto_treatments.py
-- (create_treatment/update_treatment INSERT/UPDATE) and DATABASE_STRUCTURE.md.
-- treatmentTotalQuantityUnitId / standardTreatmentTotalQuantity /
-- treatmentTotalQuantityUsedUnitId / standardTreatmentTotalQuantityUsed folded
-- in verbatim (including column placement via the original ALTER's AFTER
-- clauses) from server/migrations/009_add_treatment_surface_and_quantity_units.sql.
-- NOTE: there is intentionally no `surfaceTreatedUnitId` column at this
-- (event) level -- server/README.md explicitly notes the event-level surface/
-- total-quantity unit is not stored separately, only the standardized value.
CREATE TABLE IF NOT EXISTS phytoTreatments (
    eventId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    eventType VARCHAR(255),
    eventDate DATE,
    eventTime TIME,
    operatorId VARCHAR(255),
    treatmentTotalQuantity DOUBLE,
    treatmentTotalQuantityUnitId VARCHAR(255),
    standardTreatmentTotalQuantity DOUBLE,
    treatmentTotalQuantityUsed DOUBLE,
    treatmentTotalQuantityUsedUnitId VARCHAR(255),
    standardTreatmentTotalQuantityUsed DOUBLE,
    surfaceTreated DOUBLE,
    standardSurfaceTreated DOUBLE,
    remarks TEXT,
    cleanFlag BOOLEAN DEFAULT 0,
    localizedTreatment BOOLEAN DEFAULT 0,
    decisionBase VARCHAR(255),
    effectiveness VARCHAR(255),
    thirdPartFlag BOOLEAN NOT NULL DEFAULT 0,
    treatmentType VARCHAR(50) NOT NULL DEFAULT 'pulvérisation',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_phytotreatments_user (userId),
    KEY idx_phytotreatments_operator (operatorId),
    KEY idx_phytotreatments_date (eventDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- phytoTreatmentsParcelsCrops  [ROUTES+DOCS, surface columns MIGRATION-confirmed]
-- =============================================================================
-- Base columns confirmed against server/app/routes/phyto_treatments.py
-- (_insert_parcels). surfaceTreated / surfaceTreatedUnitId /
-- standardSurfaceTreated folded in verbatim (including column placement) from
-- server/migrations/009_add_treatment_surface_and_quantity_units.sql.
-- surfaceTreatedUnitId documented as TEXT there; stored here as VARCHAR(255)
-- for indexability, same rationale as parcels.parcelAreaUnitId above.
CREATE TABLE IF NOT EXISTS phytoTreatmentsParcelsCrops (
    eventParcelsId VARCHAR(255) NOT NULL PRIMARY KEY,
    eventId VARCHAR(255) NOT NULL,
    userId VARCHAR(255) NOT NULL,
    parcelId VARCHAR(255),
    parcelName VARCHAR(255),
    cropId VARCHAR(255),
    cropName VARCHAR(255),
    phytowebCropName VARCHAR(255),
    treatmentQuantity DOUBLE,
    treatmentQuantityUnitId VARCHAR(255),
    standardTreatmentQuantity DOUBLE,
    surfaceTreated DOUBLE,
    surfaceTreatedUnitId VARCHAR(255),
    standardSurfaceTreated DOUBLE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_ptpc_event (eventId),
    KEY idx_ptpc_user (userId),
    KEY idx_ptpc_parcel (parcelId),
    KEY idx_ptpc_crop (cropId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- phytoTreatmentsComposition  [ROUTES+DOCS]
-- =============================================================================
-- Columns/order confirmed against server/app/routes/phyto_treatments.py
-- (_insert_composition) and DATABASE_STRUCTURE.md.
CREATE TABLE IF NOT EXISTS phytoTreatmentsComposition (
    eventCompositionId VARCHAR(255) NOT NULL PRIMARY KEY,
    eventId VARCHAR(255) NOT NULL,
    userId VARCHAR(255) NOT NULL,
    productId VARCHAR(255),
    productName VARCHAR(255),
    productNumAut VARCHAR(255),
    productDose DOUBLE,
    productDoseUnitId VARCHAR(255),
    standardProductDose DOUBLE,
    productQuantity DOUBLE,
    productQuantityUnitId VARCHAR(255),
    productTarget VARCHAR(255),
    standardProductQuantity DOUBLE,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_ptc_event (eventId),
    KEY idx_ptc_user (userId),
    KEY idx_ptc_product (productId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- fieldWorks  [ROUTES+DOCS, standardEventDose column MIGRATION-confirmed]
-- =============================================================================
-- Base columns confirmed against server/app/routes/field_works.py
-- (create_field_work INSERT). standardEventDose (DOUBLE, placed right after
-- eventDoseUnitId) folded in verbatim from
-- server/migrations/007_add_field_works_standard_event_dose.sql.
CREATE TABLE IF NOT EXISTS fieldWorks (
    eventId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    eventType VARCHAR(255),
    eventDate DATE,
    eventInfo TEXT,
    remarks TEXT,
    eventDose DOUBLE,
    eventDoseUnitId VARCHAR(255),
    standardEventDose DOUBLE,
    eventTool VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_fieldworks_user (userId),
    KEY idx_fieldworks_date (eventDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- fieldWorksParcelsCrops  [ROUTES+DOCS]
-- =============================================================================
-- Columns/order confirmed against server/app/routes/field_works.py (_insert_parcels).
CREATE TABLE IF NOT EXISTS fieldWorksParcelsCrops (
    eventParcelsId VARCHAR(255) NOT NULL PRIMARY KEY,
    eventId VARCHAR(255) NOT NULL,
    userId VARCHAR(255) NOT NULL,
    parcelId VARCHAR(255),
    parcelName VARCHAR(255),
    cropId VARCHAR(255),
    cropName VARCHAR(255),
    phytowebCropName VARCHAR(255),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_fwpc_event (eventId),
    KEY idx_fwpc_user (userId),
    KEY idx_fwpc_parcel (parcelId),
    KEY idx_fwpc_crop (cropId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- inventoriesOperations  [ROUTES+DOCS]
-- =============================================================================
-- Flat ledger of manually-entered stock movements only (purchases + PPNU/PPNV
-- declarations) -- treatment consumption is read live from
-- phytoTreatmentsComposition and never copied here (see server/app/utils/inventory_stock.py).
-- Columns/order confirmed against server/app/routes/inventories.py.
CREATE TABLE IF NOT EXISTS inventoriesOperations (
    inventoryOperationId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255) NOT NULL,
    productId VARCHAR(255),
    operationType VARCHAR(50),
    operationDate DATE,
    quantity DOUBLE,
    quantityUnitId VARCHAR(255),
    standardQuantity DOUBLE,
    correctionMode VARCHAR(10) NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_invops_user (userId),
    KEY idx_invops_product (productId),
    KEY idx_invops_type (operationType)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- personalProducts  [MIGRATION 006, verbatim]
-- =============================================================================
CREATE TABLE IF NOT EXISTS personalProducts (
    productId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255),
    productName TEXT,
    productType TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_personalproducts_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- admins  [MIGRATION 001, verbatim]
-- =============================================================================
CREATE TABLE IF NOT EXISTS admins (
    userId VARCHAR(255) NOT NULL PRIMARY KEY,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- mandates  [MIGRATION 002, verbatim]
-- =============================================================================
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
    KEY idx_mandates_owner (ownerUserId),
    KEY idx_mandates_mandate_user (mandateUserId),
    KEY idx_mandates_mandate_mail (mandateUserMail)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- userProfile, preferences  [MIGRATION 003, verbatim]
-- =============================================================================
CREATE TABLE IF NOT EXISTS userProfile (
    userId VARCHAR(255) NOT NULL PRIMARY KEY,
    phytolicence TEXT,
    exploitingNumber TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- (table `preferences` de la migration 003 supprimée par la migration 015, remplacée par userPreferences)

-- userPreferences  [MIGRATION 014] — préférences d'encodage des traitements phyto
CREATE TABLE IF NOT EXISTS userPreferences (
    idUser VARCHAR(255) NOT NULL PRIMARY KEY,
    erRiWarningFlag BOOLEAN NOT NULL DEFAULT 0,
    spe8HourWarningFlag BOOLEAN NOT NULL DEFAULT 1,
    bbchWarningFlag BOOLEAN NOT NULL DEFAULT 1,
    defaultTreatmentType VARCHAR(20) NOT NULL DEFAULT 'surface',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- formations  [MIGRATION 004, verbatim]
-- =============================================================================
-- NOTE: server/app/DATABASE_STRUCTURE.md documents a DIFFERENT, incorrect
-- schema for this table (formationName/formationLocation/formationDuration/
-- infoLink/formationDate) -- server/README.md explicitly flags that doc as
-- speculative and written before the table was exposed by any route. The
-- schema below (day/month/title/location/time/link/orderIndex) is the one
-- actually created by the migration and used by server/app/routes/formations.py.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- phytowebCategoryOverrides  [MIGRATION 005, verbatim]
-- =============================================================================
CREATE TABLE IF NOT EXISTS phytowebCategoryOverrides (
    cropId VARCHAR(255) NOT NULL PRIMARY KEY,
    initialCropId VARCHAR(255) NOT NULL,
    nameFr TEXT,
    eppoCode TEXT,
    hierarchyIdList TEXT,
    visibleStatut BOOLEAN DEFAULT 1,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_category_overrides_initial (initialCropId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- End of schema. 19 tables total (18 native to c2544857c_appifield +
-- unitsIndex duplicated from c2544857c_corderPhytoweb for local convenience).
-- =============================================================================
