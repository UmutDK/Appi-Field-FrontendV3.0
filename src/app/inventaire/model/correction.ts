export interface CorrectionEntry {
    date: string;
    mode: 'plus' | 'minus';
    quantity: number; // toujours positive : le sens est donné par mode
    unit: string; // 'L' | 'Kg'
}
