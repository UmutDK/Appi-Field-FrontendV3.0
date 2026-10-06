import { PpnuPpnv } from "./ppnu-ppnv";
import { Usage } from "./usage";

export class Inventaire {
    constructor(
        public porduct_name: string, 
        public product_numaut: string, 
        public quantity_buyed: number, 
        public quantity_remaining: number, 
        public quantity_percentage: number, 
        public quantity_used: number, 
        public quantity_ppnu: number, 
        public quantity_ppnv: number, 
        public quantity_unit: string, 
        public ppnu_ppnv: PpnuPpnv[], 
        public usages: Usage[], 
    ){}
}
