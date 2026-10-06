export interface InventoryStock {
  product_id: string;
  product_name: string;
  product_numaut: string;
  quantity_buyed: number;
  quantity_used: number;
  quantity_ppnu: number;
  quantity_ppnv: number;
  quantity_unit: string;
  ppnu_ppnv: any[];
}

export interface InventoryEntry {
  inventory_id: string;
  exploitation_id: string;
  inventory_stock: InventoryStock[];
}
