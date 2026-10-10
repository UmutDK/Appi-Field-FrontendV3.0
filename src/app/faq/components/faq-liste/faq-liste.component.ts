import { Component } from '@angular/core';
import { FaqListeItemComponent } from "../faq-liste-item/faq-liste-item.component";

@Component({
  selector: 'app-faq-liste',
  standalone: true,
  imports: [FaqListeItemComponent],
  templateUrl: './faq-liste.component.html',
  styleUrl: './faq-liste.component.scss'
})
export class FaqListeComponent {

}
