import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NumericInputDirective } from './directives/numeric-input.directive';


@NgModule({
  declarations: [],
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    FormsModule,
    NumericInputDirective,
  ],
  exports:[
    CommonModule,
    RouterLink,
    RouterLinkActive,
    ReactiveFormsModule,
    FormsModule,
    NumericInputDirective,
  ]
})
export class SharedModule { }
