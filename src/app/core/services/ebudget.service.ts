import { Injectable } from '@angular/core';
import { getFirebaseBackend } from '../../authUtils';
import { User } from 'src/app/store/Authentication/auth.models';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, map, finalize } from 'rxjs/operators';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { GlobalComponent } from "../../global-component";
import { Store } from '@ngrx/store';
import { environment } from 'src/environments/environment';
import { LoadingService } from './loading.service';

const EMO_API = environment.EMO_API;

const httpOptions = {
    headers: new HttpHeaders({ 'Content-Type': 'application/json' })
};


@Injectable({ providedIn: 'root' })

export class EbudgetService {

    user!: User;
    currentUserValue: any;

    private currentUserSubject: BehaviorSubject<User>;
    // public currentUser: Observable<User>;
    constructor(
        private http: HttpClient,
        private store: Store,
        private loadingService: LoadingService
    ) {
        this.currentUserSubject = new BehaviorSubject<User>(JSON.parse(sessionStorage.getItem('authen')!));
        // this.currentUser = this.currentUserSubject.asObservable();
    }

    GatewayGetData(model: any) {
        this.loadingService.show('กำลังดึงข้อมูล...');

        // if (!this.currentUserSubject || !this.currentUserSubject.value) {

        //     window.location.href = 'https://bfast.pacc.go.th/cls_erp_management_front/';
        //     return of(null);
        // }



        return this.http.post(EMO_API + 'GATE_WAY/GATEWAY_EXCHANGE', {
            MODEL: this.serializeModelWithPersonalId(model)
        }).pipe(
            map((response: any) => {
                return response;
            }),
            catchError((error: any) => {
                const errorMessage = error; // Customize the error message as needed
                return throwError(errorMessage);
            }),
            finalize(() => {
                this.loadingService.hide();
            })
        );
    }

    GatewayGetData_NODATE(model: any) {
        this.loadingService.show('กำลังดึงข้อมูล...');

        if (!this.currentUserSubject || !this.currentUserSubject.value) {

            window.location.href = environment.MANAGEMENT_FRONT;
            return of(null);
        }



        return this.http.post(EMO_API + 'GATE_WAY/GATEWAY_EXCHANGE_NO_CDATE', {
            MODEL: this.serializeModelWithPersonalId(model)
        }).pipe(
            map((response: any) => {
                return response;
            }),
            catchError((error: any) => {
                const errorMessage = error; // Customize the error message as needed
                return throwError(errorMessage);
            }),
            finalize(() => {
                this.loadingService.hide();
            })
        );
    }

    GetBudgetPlanSumUse(bgYear: number, departmentId: number, planId: number) {
        let params = new HttpParams()
            .set('BgYear', String(bgYear))
            .set('Dept', String(departmentId))
            .set('Plan_Id', String(planId));

        const token = this.getStoredToken();
        if (token) {
            params = params.set('Token', token);
        }

        return this.http.get<any>(
            'https://bfast.pacc.go.th/CLS_ERP_API_DEMO/Finance_Api/Get_Data_Budget_Plan_Sum_Use_By_BgYear_Dept',
            { params }
        );
    }

    private getStoredToken(): string | null {
        const token = localStorage.getItem('token')
            || localStorage.getItem('userToken')
            || localStorage.getItem('Token')
            || localStorage.getItem('authToken');

        if (token) {
            return token;
        }

        try {
            return JSON.parse(localStorage.getItem('userSession') || '{}')?.token || null;
        } catch {
            return null;
        }
    }

    /**
     * Add audit identity without replacing the original creator. Existing rows
     * already have Create_User and therefore receive Update_User only; new rows
     * receive Create_User only. The same rule is applied to the root request so
     * an edit request never receives a new Create_User implicitly.
     */
    private serializeModelWithPersonalId(model: any): string {
        const personalId = this.getCurrentPersonalId();

        if (!personalId) {
            return JSON.stringify(model);
        }

        return JSON.stringify(model, (_key: string, value: any) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const hasCreator = value.Create_User !== null
                    && value.Create_User !== undefined
                    && String(value.Create_User).trim() !== '';

                if (hasCreator) {
                    return {
                        ...value,
                        Update_User: personalId
                    };
                }

                return {
                    ...value,
                    Create_User: personalId
                };
            }

            return value;
        });
    }

    private getCurrentPersonalId(): string {
        const selectedPermission = this.readStoredJson('selectedPermission');
        const userSession = this.readStoredJson('userSession');
        const authen = this.readStoredJson('authen');
        const currentUser = this.readStoredJson('currentUser');

        const personalId =
            selectedPermission?.Personal_Id ??
            selectedPermission?.PERSONAL_ID ??
            userSession?.permissionData?.Personal_Id ??
            userSession?.permissionData?.PERSONAL_ID ??
            userSession?.authenData?.Personal_Id ??
            userSession?.authenData?.PERSONAL_ID ??
            authen?.Personal_Id ??
            authen?.PERSONAL_ID ??
            currentUser?.Personal_Id ??
            currentUser?.PERSONAL_ID ??
            '';

        return String(personalId).trim();
    }

    private readStoredJson(key: string): any {
        const value = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (!value) {
            return null;
        }

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    DeleteBudgetRequestDetailItem(requestItemId: any) {
        const id =
            Number(requestItemId || 0);

        if (id <= 0) {
            return of(null);
        }

        return this.GatewayGetData({
            FUNC_CODE: 'FUNC-Delete_Budget_Request_Detail_Item',
            Request_Id: id
        });
    }

    UploadData(model: FormData) {
        this.loadingService.show('กำลังอัปโหลดข้อมูล...');

        return this.http.post(EMO_API + 'GATE_WAY/ProcessRequest', model).pipe(
            map((response: any) => {
                return response;
            }),
            catchError((error: any) => {
                const errorMessage = error; // Customize the error message as needed
                return throwError(errorMessage);
            }),
            finalize(() => {
                this.loadingService.hide();
            })
        );
    }

    GetSetFullModel() {
        this.loadingService.show('กำลังโหลดข้อมูลโมเดล...');

        return this.http.get(EMO_API + 'GET_DATA/SET_FULL_MODEL').pipe(
            map((response: any) => {
                return response;
            }),
            catchError((error: any) => {
                const errorMessage = error; // Customize the error message as needed
                return throwError(errorMessage);
            }),
            finalize(() => {
                this.loadingService.hide();
            })
        );
    }


}
