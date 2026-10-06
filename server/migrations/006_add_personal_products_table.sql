-- Base : c2544857c_appifield
-- Table jamais créée alors que le code (app/routes/personal_products.py) et la
-- documentation (DATABASE_STRUCTURE.md) la référencent depuis le début — GET/POST/PUT/DELETE
-- /personal_products échouaient systématiquement (table inexistante).

CREATE TABLE IF NOT EXISTS personalProducts (
    productId VARCHAR(255) NOT NULL PRIMARY KEY,
    userId VARCHAR(255),
    productName TEXT,
    productType TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    modifiedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
