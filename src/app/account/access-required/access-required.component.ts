import { Component } from '@angular/core';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-access-required',
  templateUrl: './access-required.component.html',
  styleUrls: ['./access-required.component.scss']
})
export class AccessRequiredComponent {
  goToLogin(): void {
    window.location.href = environment.MANAGEMENT_FRONT;
  }
}
