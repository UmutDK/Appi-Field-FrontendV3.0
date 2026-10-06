import { Component } from '@angular/core';
import { FaqListeItemComponent } from "../faq-liste-item/faq-liste-item.component";
import { BackToTopComponent } from '../../../shared/components/back-to-top/back-to-top.component';

@Component({
  selector: 'app-faq-liste',
  standalone: true,
  imports: [FaqListeItemComponent, BackToTopComponent],
  templateUrl: './faq-liste.component.html',
  styleUrl: './faq-liste.component.scss'
})
export class FaqListeComponent {

}
