import { Directive, ElementRef, HostListener } from '@angular/core';

// Restreint la saisie d'un <input> aux chiffres et à un seul séparateur décimal
// (virgule ou point) — utilisé sur les champs "Superficie" des formulaires parcelles.
@Directive({
  selector: '[appNumericInput]',
  standalone: true
})
export class NumericInputDirective {

  private readonly allowedNavigationKeys = [
    'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'
  ];

  constructor(private el: ElementRef<HTMLInputElement>) {}

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (this.allowedNavigationKeys.includes(event.key)) {
      return;
    }
    // Raccourcis clavier (copier/coller/sélectionner tout...)
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      return;
    }
    if ((event.key === ',' || event.key === '.') && !/[.,]/.test(this.el.nativeElement.value)) {
      return;
    }
    event.preventDefault();
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const digits = pasted.replace(/[^0-9.,]/g, '');
    // Ne garde que le premier séparateur décimal rencontré.
    const firstSeparatorIndex = digits.search(/[.,]/);
    const sanitized = firstSeparatorIndex === -1
      ? digits
      : digits.slice(0, firstSeparatorIndex + 1) + digits.slice(firstSeparatorIndex + 1).replace(/[.,]/g, '');

    const input = this.el.nativeElement;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const newValue = input.value.slice(0, start) + sanitized + input.value.slice(end);
    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + sanitized.length;
    input.setSelectionRange(caret, caret);
  }
}
