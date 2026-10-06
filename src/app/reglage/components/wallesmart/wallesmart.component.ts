import { Component, OnInit, signal } from '@angular/core';
import { SharedModule } from '../../../shared/shared.module';
import { WallesmartService } from '../../../core/services/wallesmart.service';

@Component({
  selector: 'app-wallesmart',
  standalone: true,
  imports: [SharedModule],
  templateUrl: './wallesmart.component.html',
  styleUrl: './wallesmart.component.scss'
})
export class WallesmartComponent implements OnInit {

  isLoading = signal<boolean>(true);
  isLinked = signal<boolean>(false);
  hasError = signal<boolean>(false);

  readonly connectUrl: string;

  constructor(private wallesmartService: WallesmartService) {
    this.connectUrl = this.wallesmartService.connectUrl;
  }

  ngOnInit(): void {
    this.wallesmartService.getStatus().subscribe({
      next: (status) => {
        this.isLinked.set(!!status.linked);
        this.isLoading.set(false);
      },
      error: () => {
        this.hasError.set(true);
        this.isLoading.set(false);
      }
    });
  }
}
