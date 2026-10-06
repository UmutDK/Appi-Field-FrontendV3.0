import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ValidationCompte } from '../model/validation-compte';
import { environment } from '../../../../environments/environment';

@Injectable()
export class ValidationCompteService {

  constructor(
    private http:HttpClient
  ) { }

  postValidation(form:any):Observable<ValidationCompte>{
    return this.http.get<ValidationCompte>(`${environment.apiUrl}/controllers/verification_mail.php?code=${form}`);
  }
}
