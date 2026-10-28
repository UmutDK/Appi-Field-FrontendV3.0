import { Directive, ElementRef, HostListener, OnDestroy, inject, input } from '@angular/core';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DraftCropRef, ProductInfoPopoverComponent } from './product-info-popover.component';

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 200;

/**
 * Affiche ProductInfoPopoverComponent à côté d'une carte produit Phytoweb :
 *  - au survol (après un court délai) sur les appareils avec souris ;
 *  - via toggle(), à brancher sur une icône ⓘ, pour les écrans tactiles (le clic sur la carte
 *    elle-même ajoute déjà le produit au traitement). Ouvert ainsi, le popup reste affiché
 *    jusqu'à un clic en dehors ou Échap.
 */
@Directive({
  selector: '[appProductInfo]',
  standalone: true,
  exportAs: 'appProductInfo'
})
export class ProductInfoDirective implements OnDestroy {
  private overlay = inject(Overlay);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  product = input<any>(null, { alias: 'appProductInfo' });
  crops = input<string[]>([], { alias: 'productInfoCrops' });
  /** Cultures du traitement (cropId + nom Phytoweb) pour le compte des applications déjà faites. */
  cropRefs = input<DraftCropRef[]>([], { alias: 'productInfoCropRefs' });
  /** Traitement en cours de modification, exclu du compte. */
  eventId = input<string | null>(null, { alias: 'productInfoEventId' });

  private overlayRef?: OverlayRef;
  private openTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private pinned = false;
  private readonly canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  @HostListener('mouseenter')
  onMouseEnter(): void {
    if (!this.canHover) return;
    clearTimeout(this.closeTimer);
    if (this.isOpen) return;
    this.openTimer = setTimeout(() => this.open(), OPEN_DELAY_MS);
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    clearTimeout(this.openTimer);
    if (!this.pinned) this.scheduleClose();
  }

  get isOpen(): boolean {
    return !!this.overlayRef?.hasAttached();
  }

  toggle(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    clearTimeout(this.openTimer);
    if (this.isOpen && this.pinned) {
      this.close();
      return;
    }
    // Déjà ouvert par le survol : un clic sur ⓘ le garde simplement affiché.
    this.pinned = true;
    this.open();
  }

  close(): void {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.pinned = false;
    this.overlayRef?.detach();
  }

  ngOnDestroy(): void {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.overlayRef?.dispose();
  }

  private open(): void {
    const product = this.product();
    if (!product?.product_id || this.isOpen) return;

    const overlayRef = this.overlayRef ?? this.createOverlay();
    const componentRef = overlayRef.attach(new ComponentPortal(ProductInfoPopoverComponent));
    componentRef.setInput('product', product);
    componentRef.setInput('crops', this.crops());
    componentRef.setInput('cropRefs', this.cropRefs());
    componentRef.setInput('excludeEventId', this.eventId());
    overlayRef.updatePosition();
  }

  private scheduleClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY_MS);
  }

  private createOverlay(): OverlayRef {
    const positionStrategy = this.overlay.position()
      .flexibleConnectedTo(this.host)
      .withPositions([
        { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 8 },
        { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -8 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 }
      ])
      .withPush(true)
      .withViewportMargin(8);

    const overlayRef = this.overlay.create({
      // Classe utilisée dans styles.scss pour passer au-dessus de la modale du traitement
      panelClass: 'product-info-pane',
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition()
    });

    // Garder le popup ouvert quand la souris passe de la carte au popup.
    overlayRef.overlayElement.addEventListener('mouseenter', () => clearTimeout(this.closeTimer));
    overlayRef.overlayElement.addEventListener('mouseleave', () => {
      if (!this.pinned) this.scheduleClose();
    });
    overlayRef.outsidePointerEvents().subscribe(event => {
      if (!this.host.nativeElement.contains(event.target as Node)) this.close();
    });
    overlayRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        // Ne fermer que le popup : sans ça, Échap remonte au document et RegistreComponent
        // ferme toute la modale de traitement (saisie en cours perdue).
        event.stopPropagation();
        this.close();
      }
    });

    this.overlayRef = overlayRef;
    return overlayRef;
  }
}
