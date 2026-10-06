export class PpnuPpnv {
    constructor(
        public date: string,
        public type: string,
        public quantity: number,
        public unit: string,
    ){}
}

export interface PpnuPpnvEntry {
    date: string;
    type: 'PPNU' | 'PPNV';
    quantity: number;
    unit: string;
    // Informations optionnelles du produit pour éviter "Produit inconnu"
    product_name?: string;
    product_numaut?: string;
}
