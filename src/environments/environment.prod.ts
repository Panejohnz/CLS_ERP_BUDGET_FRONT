export const environment = {
  production: true,
  defaultauth: 'fakebackend',
  firebaseConfig: {
    apiKey: '',
    authDomain: '',
    databaseURL: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
    measurementId: ''
  },
  // production
  EMO_API: location.origin + "/CLS_E_BUDGET_BACKEND_DEMO/",
  DownloadExamUrl: location.origin + "/CLS_E_BUDGET_BACKEND_DEMO/DownLoad_File/Download_File_TEMPLATE",
  PreviewExamUrl: location.origin + "/CLS_E_BUDGET_BACKEND_DEMO/DownLoad_File/Preview_File_Template",
  GET_AUTHEN: location.origin + "/CLS_E_BUDGET_BACKEND_DEMO/GET_DATA/GET_AUTHEN",
  GET_MENU: location.origin + "/CLS_E_BUDGET_BACKEND_DEMO/GET_DATA/GetMenu",

  // เพิ่ม endpoint สำหรับ menu
  EXPORT_REPORT: 'https://fdaemonitor.fda.moph.go.th/CLS_EMONITOR_KPI_REPORT/Report/Report_R002.aspx',
  //ng build --base-href /CLS_ERP_BUDGET_FRONT/ --aot   --configuration production
  // ----------------------------------------------------------------------------
  //get permission from management
  // Use the public HTTPS origin to avoid browser mixed-content and CORS failures.

  CLS_MANAGEMENT: location.origin + '/cls_erp_management_demo/',
  UPDATE_SESSION: location.origin + '/cls_erp_management_demo/GET_DATA/Update_Session',
  MANAGEMENT_FRONT: location.origin + '/cls_erp_management_demo_front/management/dashboard'

  // -------------------------------------------------------------------------------------------------------------------------

};
