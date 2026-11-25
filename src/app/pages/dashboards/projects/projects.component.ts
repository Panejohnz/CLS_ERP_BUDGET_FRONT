import { Component, NgZone, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { EbudgetService } from 'src/app/core/services/ebudget.service';
import { BudgetYearService } from 'src/app/core/services/budget-year.service';
import * as XLSX from 'xlsx';

@Component({
  selector: 'app-projects',
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.scss']
})
export class ProjectsComponent implements OnInit {

  constructor(
    private servicebud: EbudgetService,
    private budgetYearService: BudgetYearService,
    private ngZone: NgZone
  ) { }

  breadCrumbItems: any[] = [];
  statData: any[] = [];
  dashboardData: any[] = [];
  activeDashboardTab: 'overview' | 'projects' | 'carryover' = 'overview';
  selectedProjectDepartment = '';
  selectedProjectPlan = '';
  selectedProjectName = '';
  selectedProjectStatus = '';
  budgetGroupFilters: Record<string, boolean> = {
    personnel: true,
    operating: true,
    investment: true,
    subsidy: true,
    other: true
  };
  currentYear = 0;
  selectedDepartmentId = 0;
  private dashboardLoadVersion = 0;
  private readonly investmentExpenseIds = [54, 55];
  private readonly dashboardMetricCache = new WeakMap<any[], Record<string, number>>();
  projectDashboardRows: any[] = [];
  filteredProjectDashboardRows: any[] = [];
  displayedProjectDashboardRows: any[] = [];
  carryoverDashboardRows: any[] = [];
  displayedCarryoverDashboardRows: any[] = [];
  projectStatusSummary: any[] = [];
  operationStatusSummary: any[] = [];
  operationStatusChart: any = { series: [] };
  projectOperationStatusOptions: any[] = [];
  projectDepartmentOptions: string[] = [];
  projectPlanOptions: string[] = [];
  projectNameOptions: string[] = [];
  projectPage = 1;
  readonly projectPageSize = 25;
  departmentBudgetModal: any = null;
  departmentBudgetLoading = false;

  get projectTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredProjectDashboardRows.length / this.projectPageSize));
  }

  setDashboardTab(tab: 'overview' | 'projects' | 'carryover'): void {
    this.activeDashboardTab = tab;
    if (tab !== 'overview' && this.projectDashboardRows.length === 0 && this.dashboardData.length > 0) {
      this.refreshProjectView(true);
    }
  }

  toggleBudgetGroup(group: string, checked: boolean): void {
    this.budgetGroupFilters[group] = checked;
    this.bindDashboard();
  }

  clearProjectFilters(): void {
    this.selectedProjectDepartment = '';
    this.selectedProjectPlan = '';
    this.selectedProjectName = '';
    this.selectedProjectStatus = '';
    this.refreshProjectView();
  }

  refreshProjectView(rebuildRows: boolean = false): void {
    if (rebuildRows) {
      this.projectDashboardRows = this.buildProjectDashboardRows();
      this.projectDepartmentOptions = this.uniqueProjectValues('department');
      this.projectPlanOptions = this.uniqueProjectValues('plan');
      this.projectNameOptions = this.uniqueProjectValues('name');
      this.projectOperationStatusOptions = Array.from(
        new Map(
          this.projectDashboardRows
            .filter((row: any) => row.operationStatusId > 0)
            .map((row: any) => [row.operationStatusId, {
              id: row.operationStatusId,
              name: row.status,
              number: row.progress,
              color: row.operationColor
            }])
        ).values()
      ).sort((a: any, b: any) => a.number - b.number);
      this.carryoverDashboardRows = this.projectDashboardRows.filter((row: any) => row.isCarryOver);
      this.displayedCarryoverDashboardRows = this.carryoverDashboardRows.slice(0, 50);
    }

    this.filteredProjectDashboardRows = this.projectDashboardRows.filter((row: any) =>
      (!this.selectedProjectDepartment || row.department === this.selectedProjectDepartment) &&
      (!this.selectedProjectPlan || row.plan === this.selectedProjectPlan) &&
      (!this.selectedProjectName || row.name === this.selectedProjectName) &&
      (!this.selectedProjectStatus || String(row.operationStatusId) === String(this.selectedProjectStatus))
    );
    const rows = this.filteredProjectDashboardRows;
    this.projectStatusSummary = [
      { key: 'complete', label: 'ดำเนินการเสร็จสิ้น', value: rows.filter(x => x.progress >= 100).length, color: 'green' },
      { key: 'progress', label: 'อยู่ระหว่างดำเนินการ', value: rows.filter(x => x.progress > 0 && x.progress < 100).length, color: 'orange' },
      { key: 'not-started', label: 'ยังไม่ดำเนินการ', value: rows.filter(x => x.progress <= 0).length, color: 'red' }
    ];
    const operationMap = new Map<number, any>();
    rows.forEach((row: any) => {
      const id = Number(row.operationStatusId || 0);
      if (id <= 0) return;
      const status = operationMap.get(id) || {
        id,
        label: row.status,
        percent: row.progress,
        color: row.operationColor || '#1688ef',
        value: 0
      };
      status.value += 1;
      operationMap.set(id, status);
    });
    this.operationStatusSummary = Array.from(operationMap.values())
      .sort((a: any, b: any) => a.percent - b.percent);
    this.operationStatusChart = {
      series: this.operationStatusSummary.map((item: any) => item.value),
      labels: this.operationStatusSummary.map((item: any) => item.label),
      colors: this.operationStatusSummary.map((item: any) => item.color),
      chart: { type: 'donut', height: 260 },
      plotOptions: {
        pie: {
          donut: {
            size: '58%',
            labels: {
              show: true,
              name: { show: true },
              value: { show: true },
              total: {
                show: true,
                label: 'โครงการ',
                formatter: () => String(rows.length)
              }
            }
          }
        }
      },
      dataLabels: {
        enabled: true,
        formatter: (value: number) => `${value.toFixed(0)}%`
      },
      legend: { show: false },
      tooltip: {
        y: { formatter: (value: number) => `${value} โครงการ` }
      }
    };
    this.projectPage = 1;
    this.updateProjectPage();
  }

  changeProjectPage(direction: number): void {
    const nextPage = this.projectPage + direction;
    if (nextPage < 1 || nextPage > this.projectTotalPages) return;
    this.projectPage = nextPage;
    this.updateProjectPage();
  }

  trackProjectRow(_index: number, row: any): any {
    return row?.budgetPlanId || row?.name;
  }

  private updateProjectPage(): void {
    const start = (this.projectPage - 1) * this.projectPageSize;
    this.displayedProjectDashboardRows = this.filteredProjectDashboardRows.slice(start, start + this.projectPageSize);
  }

  private buildProjectDashboardRows(): any[] {
    const grouped = new Map<string, any>();

    // The project dashboard must not include recurring expense rows such as
    // salaries.  Keep only records explicitly linked to a project (or with a
    // project name supplied by the API).
    (this.dashboardData || []).filter((row: any) => this.isProjectDashboardRow(row)).forEach((row: any) => {
      const key = String(
        row?.Budget_Plan_Id || row?.Fk_Budget_Plan_Id ||
        row?.Project_Id || row?.FK_Project_Id ||
        `${row?.Department_Id || 0}_${row?.Project_Name || row?.Plan_Name || row?.Expense_List || '-'}`
      );
      const current = grouped.get(key) || {
        budgetPlanId: row?.Budget_Plan_Id || row?.Fk_Budget_Plan_Id || 0,
        name: row?.Project_Name || row?.Plan_Name || row?.Expense_List || 'ไม่ระบุชื่อโครงการ/รายการ',
        department: row?.Department_Name || row?.Department_Short_Name || '-',
        status: row?.Operation_Status_Name || row?.Status_Name || '-',
        operationStatusId: Number(row?.Operation_Status_Id || 0),
        progressPercent: row?.Progress_Percent,
        operationNumber: this.toDashboardNumber(row?.Operation_Number),
        operationColor: row?.Operation_Color_Code || '#1688ef',
        operationShortName: row?.Operation_Short_Name || row?.Operation_Status_Name || '-',
        isCarryOver: row?.Is_Carry_Over === true || Number(row?.Is_Carry_Over) === 1,
        plan: row?.Plan_Name || '-',
        budget: 0,
        used: 0,
        withdraw: 0
      };

      current.budget += this.toDashboardNumber(row?.Adjust || row?.Total_Plan);
      current.used += this.toDashboardNumber(row?.Sum_Used);
      current.withdraw += this.toDashboardNumber(row?.Sum_Withdraw);
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).map((row: any) => {
      const reportedProgress = row.operationNumber > 0
        ? row.operationNumber
        : this.toDashboardNumber(row.progressPercent);
      const progress = row.progressPercent !== null && row.progressPercent !== undefined && row.progressPercent !== ''
        ? Math.min(100, reportedProgress)
        : row.budget > 0 ? Math.min(100, (row.withdraw / row.budget) * 100) : 0;

      return {
        ...row,
        remaining: row.budget - row.withdraw,
        usedPercent: row.budget > 0 ? Math.min(100, (row.used / row.budget) * 100) : 0,
        withdrawPercent: row.budget > 0 ? Math.min(100, (row.withdraw / row.budget) * 100) : 0,
        progress,
        progressStatus: progress >= 100 ? 'complete' : progress > 0 ? 'progress' : 'not-started'
      };
    });
  }

  private uniqueProjectValues(field: string): string[] {
    return Array.from(new Set(this.projectDashboardRows.map((row: any) => row?.[field]).filter(Boolean))).sort();
  }

  private isProjectDashboardRow(row: any): boolean {
    const projectId = row?.Project_Id ?? row?.FK_Project_Id ?? row?.Fk_Project_Id;
    if (projectId !== null && projectId !== undefined && String(projectId).trim() !== '') {
      return Number.isNaN(Number(projectId)) || Number(projectId) > 0;
    }

    return String(row?.Project_Name ?? '').trim().length > 0;
  }

  dashboardMetric(rows: any[], field: 'budget' | 'used' | 'withdraw' | 'remaining'): number {
    const source = rows || [];
    let cached = this.dashboardMetricCache.get(source);
    if (!cached) {
      cached = {};
      this.dashboardMetricCache.set(source, cached);
    }
    if (cached[field] === undefined) {
      cached[field] = source.reduce(
        (total: number, row: any) => total + this.toDashboardNumber(row?.[field]),
        0
      );
    }
    return cached[field];
  }

  chartNotes = {
    pieBudgetType: '',
    barBudgetType: '',
    plan: '',
    department: '',
    quarterPie: '',
    quarterBar: ''
  };

  pieChart: any = {
    series: [],
    chart: {
      type: 'pie',
      height: 300
    },
    labels: [],
    colors: ['#0eb6c2', '#08ad71', '#ca9612', '#644afa', '#f85540']
  };

  pieQuarterChart: any = {
  series: [],
  chart: {
    type: 'pie',
    height: 350
  },
  labels: [],
  colors: [
    '#0d6efd', // ไตรมาส 1
    '#198754', // ไตรมาส 2
    '#ffc107', // ไตรมาส 3
    '#dc3545'  // ไตรมาส 4
  ],
  legend: {
    position: 'bottom'
  },
  tooltip: {},
  dataLabels: {}
};

  barLineChart: any = {
    series: [],
    chart: {
      type: 'line',
      height: 300
    },
    stroke: {
      width: [0, 0, 3],
      curve: 'smooth'
    },
    colors: ['#4e73df', '#1cc88a', '#e74a3b'],
    xaxis: {
      categories: []
    },
    legend: {
      position: 'top'
    }
  };

  comboChart: any = {
    series: [],
    chart: {
      height: 350,
      type: 'bar',
      stacked: false
    },
    stroke: {
      width: [0, 0, 3],
      curve: 'smooth'
    },
    colors: ['#4e73df', '#1cc88a', '#e74a3b'],
    plotOptions: {
      bar: {
        columnWidth: '55%',
        borderRadius: 4
      }
    },
    dataLabels: {
      enabled: false
    },
    xaxis: {
      categories: []
    },
    legend: {
      position: 'top'
    }
  };

 comboChart2: any = {
  series: [],
  chart: {
    height: 350,
    type: 'bar'
  },
  stroke: {
    width: [0, 0, 0]
  },
  colors: ['#0d6efd', '#198754', '#ffc107'],
  plotOptions: {
    bar: {
      columnWidth: '25%',
      borderRadius: 3
    }
  },
  dataLabels: {
    enabled: false
  },
  xaxis: {
    categories: []
  },
  legend: {
    position: 'top'
  }
};

  pieChart2: any = {
    series: [],
    chart: {
      type: 'pie',
      height: 300
    },
    labels: [],
    colors: ['#4e73df', '#1cc88a', '#f6c23e', '#ff0000']
  };

  barLineChart2: any = {
    series: [],
    chart: {
      type: 'line',
      height: 300
    },
    stroke: {
      width: [0, 0, 3],
      curve: 'smooth'
    },
    colors: ['#4e73df', '#1cc88a', '#e74a3b'],
    xaxis: {
      categories: []
    },
    legend: {
      position: 'top'
    }
  };

    barQuarterChart2: any = {
  series: [],
  chart: {
    type: 'bar',
    height: 350
  },
  colors: ['#4e73df', '#ffc107'],
  stroke: {
    width: [0, 0]
  },
  plotOptions: {
    bar: {
      columnWidth: '45%',
      borderRadius: 4
    }
  },
  dataLabels: {
    enabled: false
  },
  xaxis: {
    categories: []
  },
  yaxis: {},
  tooltip: {},
  legend: {
    position: 'top'
  }
};

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Dashboard' }];

    this.budgetYearService.yearChanged$
      .subscribe((year: any) => {
        if (!year) {
          return;
        }

        this.currentYear = year < 2500 ? year + 543 : year;
        this.getDashboard();
      });
  }

  dashboardCheck: any = null;

getDashboard() {
  const loadVersion = ++this.dashboardLoadVersion;
  const model = {
    FUNC_CODE: 'FUNC-Get_Dashboard',
    BgYear: this.currentYear,
    Department_Id: this.selectedDepartmentId || 0
  };

  this.servicebud.GatewayGetData(model).subscribe({
    next: (response: any) => {

      console.log('response.List_Dashboard?.Data', response.List_Dashboard?.Data);
      console.log('response.List_Dashboard_Check?.Data', response.List_Dashboard_Check?.Data);
      // console.log('List_Dashboard_Check', response.List_Dashboard_Check?.Data);
      // Dashboard หลัก
      this.dashboardData =
        Array.isArray(response.List_Dashboard?.Data)
          ? response.List_Dashboard.Data
          : Array.isArray(response.Data)
            ? response.Data
            : Array.isArray(response)
              ? response
              : [];

      // Dashboard Check (มีแค่ 1 แถว)
      this.dashboardCheck =
        Array.isArray(response.List_Dashboard_Check?.Data)
          ? response.List_Dashboard_Check.Data[0]
          : Array.isArray(response.List_Dashboard_Check)
            ? response.List_Dashboard_Check[0]
            : response.List_Dashboard_Check || null;

      this.loadDashboardDepartmentOrder(this.dashboardData, loadVersion, () => {
        this.loadDashboardUsage(this.dashboardData, loadVersion, () => {
          if (loadVersion === this.dashboardLoadVersion) {
            this.bindDashboard();
          }
        });
      });
    },

    error: (err: any) => {
      console.error('GET DASHBOARD ERROR', err);

      this.dashboardData = [];
      this.dashboardCheck = null;

      this.bindDashboard();
    }
  });
}

  /** เติม Department_Type / Department_Cost_Code จาก master เพราะข้อมูล
   * Dashboard บางรายการไม่มีสอง field นี้ติดมาด้วย */
  private loadDashboardDepartmentOrder(
    dashboardRows: any[],
    loadVersion: number,
    complete: () => void
  ): void {
    this.servicebud.GatewayGetData({
      FUNC_CODE: 'FUNC-GET_Mas_Search',
      BgYear: this.currentYear
    }).pipe(catchError(() => of(null))).subscribe((response: any) => {
      if (loadVersion !== this.dashboardLoadVersion) {
        return;
      }

      const departments = Array.isArray(response?.Mas_Department_Lists)
        ? response.Mas_Department_Lists
        : [];
      const departmentById = new Map<string, any>(
        departments.map((department: any) => [String(department?.Department_Id), department])
      );

      this.dashboardData = (dashboardRows || []).map((row: any) => {
        const departmentId = row?.Department_Id ?? row?.Fk_Department_Id;
        const department = departmentById.get(String(departmentId));

        return {
          ...row,
          Department_Type: this.getDepartmentField(row, 'Department_Type')
            ?? this.getDepartmentField(department, 'Department_Type'),
          Department_Cost_Code: this.getDepartmentField(row, 'Department_Cost_Code')
            ?? this.getDepartmentField(department, 'Department_Cost_Code')
        };
      });

      complete();
    });
  }

  private loadDashboardUsage(
    dashboardRows: any[],
    loadVersion: number,
    complete: () => void
  ): void {
    const rows = Array.isArray(dashboardRows) ? dashboardRows : [];
    const requests = new Map<string, { departmentId: number; planId: number }>();

    rows.forEach((row: any) => {
      const planId = Number(row?.Budget_Plan_Id || row?.Fk_Budget_Plan_Id || 0);
      const departmentId = Number(row?.Department_Id || this.selectedDepartmentId || 0);

      if (planId > 0 && departmentId > 0) {
        requests.set(`${departmentId}_${planId}`, { departmentId, planId });
      }
    });

    if (requests.size === 0) {
      complete();
      return;
    }

    const requestEntries = Array.from(requests.entries());
    forkJoin(
      requestEntries.map(([, request]) =>
        this.servicebud
          .GetBudgetPlanSumUse(this.currentYear, request.departmentId, request.planId)
          .pipe(catchError(() => of(null)))
      )
    ).subscribe((responses: any[]) => {
      if (loadVersion !== this.dashboardLoadVersion) {
        return;
      }

      const usageByPlan = new Map<string, any>();
      responses.forEach((response: any, index: number) => {
        usageByPlan.set(
          requestEntries[index][0],
          this.getDashboardUsageTotals(response)
        );
      });

      this.dashboardData = rows.map((row: any) => {
        const planId = Number(row?.Budget_Plan_Id || row?.Fk_Budget_Plan_Id || 0);
        const departmentId = Number(row?.Department_Id || this.selectedDepartmentId || 0);
        const usage = usageByPlan.get(`${departmentId}_${planId}`);

        return usage ? { ...row, ...usage } : row;
      });

      complete();
    });
  }

  private getDashboardUsageTotals(response: any): any {
    const usageRows = response?.List_Sum_Use_Amount_Budget_Plan_Api;
    const list = Array.isArray(usageRows)
      ? usageRows
      : Array.isArray(usageRows?.Data)
        ? usageRows.Data
        : [];

    const sum = (fields: string[]): number => list.reduce(
      (total: number, item: any) => total + fields.reduce(
        (fieldTotal: number, field: string) =>
          fieldTotal + this.toDashboardNumber(item?.[field]),
        0
      ),
      0
    );

    return {
      Sum_Used: sum(['sum_use_amount']),
      Sum_Withdraw: sum(['sum_withdraw_amount']),
      Sum_Used_Tri1: sum(['Oct_Use', 'Nov_Use', 'Dec_Use']),
      Sum_Withdraw_Tri1: sum(['Oct_Withdraw', 'Nov_Withdraw', 'Dec_Withdraw']),
      Sum_Used_Tri2: sum(['Jan_Use', 'Feb_Use', 'Mar_Use']),
      Sum_Withdraw_Tri2: sum(['Jan_Withdraw', 'Feb_Withdraw', 'Mar_Withdraw']),
      Sum_Used_Tri3: sum(['Apr_Use', 'May_Use', 'Jun_Use']),
      Sum_Withdraw_Tri3: sum(['Apr_Withdraw', 'May_Withdraw', 'Jun_Withdraw']),
      Sum_Used_Tri4: sum(['Jul_Use', 'Aug_Use', 'Sep_Use']),
      Sum_Withdraw_Tri4: sum(['Jul_Withdraw', 'Aug_Withdraw', 'Sep_Withdraw'])
    };
  }

  private toDashboardNumber(value: any): number {
    const numberValue = Number(String(value ?? 0).replace(/,/g, ''));
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  bindDashboard() {
    const data = (this.dashboardData || []).filter((row: any) =>
      this.budgetGroupFilters[this.getBudgetGroupKey(row)] !== false
    );

    const totalBudget = this.sum(data, 'Total_Plan');
    const totalAdjust = this.sum(data, 'Adjust');
    // Some dashboard responses provide the allocated amount only in
    // Total_Plan and leave Adjust at zero.  Use that amount for the summary
    // cards when there is no adjustment data at all.
    const allocatedBudget = totalAdjust !== 0 ? totalAdjust : totalBudget;
    const totalburse = this.sum(data, 'Sum_Withdraw');
    const totalRemaining = allocatedBudget - totalburse;

    // ค่าใช้จ่าย 54, 55 ต้องแสดงในรายจ่ายลงทุน แม้ Budget Type เดิม
    // จะถูกจัดเป็นรายจ่ายประจำ
    const isRecurring = (row: any) => this.isRecurringDashboardRow(row);
    const isInvestment = (row: any) => this.isInvestmentDashboardRow(row);

    const recurringAdjust = this.sumByCondition(data, 'Adjust', isRecurring);
    const recurringBudget = this.sumByCondition(data, 'Total_Plan', isRecurring);
    const recurringburse = this.sumByCondition(data, 'Sum_Withdraw', isRecurring);
    const recurringAllocated = recurringAdjust !== 0 ? recurringAdjust : recurringBudget;
    const recurringRemaining = recurringAllocated - recurringburse;

    const investmentAdjust = this.sumByCondition(data, 'Adjust', isInvestment);
    const investmentBudget = this.sumByCondition(data, 'Total_Plan', isInvestment);
    const investmentburse = this.sumByCondition(data, 'Sum_Withdraw', isInvestment);
    const investmentAllocated = investmentAdjust !== 0 ? investmentAdjust : investmentBudget;
    const investmentRemaining = investmentAllocated - investmentburse;

    this.statData = [
      {
        title: 'ภาพรวมงบประมาณ',
        value: this.formatMoney(allocatedBudget),
        Reimburse: this.formatMoney(totalburse),
        Remaining: this.formatMoney(totalRemaining),
        icon: 'ri-money-dollar-circle-line',
        persantage: '',
        profit: 'up',
        month: 'บาท'
      },
      {
        title: 'รายจ่ายประจำ',
        value: this.formatMoney(recurringAllocated),
        Reimburse: this.formatMoney(recurringburse),
        Remaining: this.formatMoney(recurringRemaining),
        icon: 'ri-wallet-3-line',
        persantage: '',
        profit: 'up',
        month: 'บาท'
      },
      {
        title: 'รายจ่ายลงทุน',
        value: this.formatMoney(investmentAllocated),
        Reimburse: this.formatMoney(investmentburse),
        Remaining: this.formatMoney(investmentRemaining),
        icon: 'ri-funds-line',
        persantage: '',
        profit: 'up',
        month: 'บาท'
      }
    ];

    this.bindPieBudgetType(data);
    this.bindBarBudgetType(data);
    this.bindPlanChart(data);
    this.bindDepartmentChart(data);
    // กราฟชื่อ "ภาพรวมงบประมาณ" จึงต้องใช้ข้อมูลทุกประเภทงบ
    // เพื่อให้ผลรวมยอดเบิกจ่ายทั้ง 4 ไตรมาสตรงกับการ์ดภาพรวมงบประมาณ
    this.bindQuarterBarChart(data);
    this.bindQuarterPieChart(data);
    this.refreshProjectView(true);
  }

  // กราฟวงกลมหมวดงบ //
bindPieBudgetType(data: any[]) {
  const useCountFallback =
    data.length > 0 && !this.hasAnyNonZero(data, ['Adjust']);

  const map = new Map<number, {
    label: string;
    value: number;
  }>();

  data.forEach((x: any) => {
    const budgetTypeId = Number(x.Budget_Type_Id || 0);

    const label =
      x.Budget_Type_Name ||
      x.Budget_Type_Name_Thai ||
      x.Budget_Type ||
      '-';

    const value = useCountFallback
      ? 1
      : Number(x.Adjust || 0);

    if (map.has(budgetTypeId)) {
      map.get(budgetTypeId)!.value += value;
    } else {
      map.set(budgetTypeId, {
        label,
        value
      });
    }
  });

  // สีประจำแต่ละประเภท
  const colorMap: { [key: number]: string } = {
    1: '#0eb6c2', // งบบุคลากร
    2: '#08ad71', // งบดำเนินงาน
    3: '#ca9612', // งบลงทุน
    4: '#644afa', // งบอุดหนุน
    5: '#f85540'  // งบรายจ่ายอื่น

  };

  const items = Array.from(map.entries());

  const labels = items.map(([_, item]) => item.label);

  const series = items.map(([_, item]) => item.value);

  const colors = items.map(([id]) =>
    colorMap[id] || '#6c757d'
  );

  this.pieChart = {
    ...this.pieChart,
    series,
    labels,
    colors,

    // Tooltip แสดงตัวเลขจริง
    tooltip: {
      y: {
        formatter: (value: number) =>
          this.formatNumber(value)
      }
    },

    // แสดงเปอร์เซ็นต์บน Pie
    dataLabels: {
      enabled: true,
      formatter: (value: number) =>
        `${value.toFixed(1)}%`,
      style: {
        colors: ['#000000'],
        fontSize: '12px',
        fontWeight: 'bold'
      }
    },

    // สีข้อความ Legend
    legend: {
      labels: {
        colors: '#000000'
      }
    }
  };

  this.chartNotes.pieBudgetType = useCountFallback
    ? 'แสดงตามจำนวนรายการ เนื่องจากยอดงบเป็น 0 ทั้งหมด'
    : '';
}

formatNumber(value: number): string {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// กราฟแท่งหมวดงบ //
bindBarBudgetType(data: any[]) {

  const useCountFallback =
    data.length > 0 &&
    !this.hasAnyNonZero(data, ['Total_Plan', 'Adjust', 'Sum_Withdraw']);

  // หมวดงบทั้งหมด
  const budgetTypes = [
    { id: 1, label: 'งบบุคลากร' },
    { id: 2, label: 'งบดำเนินงาน' },
    { id: 3, label: 'งบลงทุน' },
    { id: 4, label: 'งบอุดหนุน' },
    { id: 5, label: 'งบรายจ่ายอื่น' }
  ];

  // เตรียมข้อมูลเริ่มต้น
  const map = new Map<number, any>();

  budgetTypes.forEach(type => {
    map.set(type.id, {
      label: type.label,
      plan: 0,
      adjust: 0,
      withdraw: 0,
      count: 0
    });
  });

  // รวมข้อมูลจริง
  data.forEach((x: any) => {

    const budgetTypeId = Number(x.Budget_Type_Id || 0);

    if (!map.has(budgetTypeId)) {
      return;
    }

    const row = map.get(budgetTypeId);

    row.plan += Number(x.Total_Plan || 0);
    row.adjust += Number(x.Adjust || 0);
    row.withdraw += Number(x.Sum_Withdraw || 0);
    row.count += 1;
  });

  const items = budgetTypes.map(type => ({
    id: type.id,
    ...map.get(type.id)
  }));

// เดือนปัจจุบัน (1-12)
const currentMonth = new Date().getMonth() + 1;

// แปลงเป็นเดือนงบประมาณ
// ต.ค.=1, พ.ย.=2, ..., ก.ย.=12
const fiscalMonth =
  currentMonth >= 10
    ? currentMonth - 9
    : currentMonth + 3;

// หาไตรมาสปัจจุบัน
const currentQuarter = Math.ceil(fiscalMonth / 3);

// เป้าหมายเบิกจ่าย (%) ตามไตรมาสปัจจุบัน
const withdrawPercent =
  Number(
    this.dashboardCheck?.[
      `Goals_Withdraw_Tri${currentQuarter}`
    ] || 0
  );

console.log({
  currentMonth,
  fiscalMonth,
  currentQuarter,
  withdrawPercent
});

  // ยอดจัดสรรรวม
  const totalAdjust = items.reduce(
    (sum, x) => sum + Number(x.adjust || 0),
    0
  );

  // เป้าหมายรวมเป็นจำนวนเงิน
  const totalTargetWithdraw =
    totalAdjust * withdrawPercent / 100;

  // กระจายเป้าหมายตามสัดส่วนของแต่ละหมวดง

  const targetWithdrawData = items.map(x => {

  const adjust = Number(x.adjust || 0);

  const ratio =
    totalAdjust > 0
      ? adjust / totalAdjust
      : 0;

  return totalTargetWithdraw * ratio;
});

// ผ่านเป้าหมาย = สีเขียว
const targetPassData = targetWithdrawData.map((target, index) =>
  Number(items[index].withdraw || 0) >= target
    ? target
    : null
);

// ไม่ผ่านเป้าหมาย = สีแดง
const targetFailData = targetWithdrawData.map((target, index) =>
  Number(items[index].withdraw || 0) < target
    ? target
    : null
);

  this.barLineChart = {
    ...this.barLineChart,

    plotOptions: {
      bar: {
        columnWidth: '35%',
        borderRadius: 3
      }
    },

    colors: useCountFallback
      ? ['#0d6efd']
      : [
          '#0d6efd', // จัดสรร
          '#198754', // แผน
          '#ffc107', // เบิกจ่าย
          '#dc3545'  // เป้าหมาย
        ],

    stroke: useCountFallback
      ? {
          width: [0]
        }
      : {
          width: [0, 0, 0, 3],
          curve: 'smooth'
        },

    series: useCountFallback
      ? [
          {
            name: 'จำนวนรายการ',
            type: 'column',
            data: items.map(x => x.count)
          }
        ]
      : [
          {
            name: 'จัดสรร',
            type: 'column',
            data: items.map(x => x.adjust)
          },
          {
            name: 'แผน',
            type: 'column',
            data: items.map(x => x.plan)
          },
          {
            name: 'เบิกจ่าย',
            type: 'column',
            data: items.map(x => x.withdraw)
          },
          {
            name: `เป้าหมาย ${withdrawPercent}%`,
            type: 'line',
            data: targetWithdrawData
          }
        ],

    xaxis: {
      categories: items.map(x => x.label)
    },

    dataLabels: {
      enabled: true,

      enabledOnSeries: useCountFallback
        ? [0]
        : [0, 1, 2], // ไม่แสดงบนเส้นเป้าหมาย

      formatter: (value: number) =>
        value === 0
          ? ''
          : this.formatNumber(value),

      style: {
        fontSize: '11px',
        fontWeight: 'bold',
        colors: ['#ffffff']
      }
    },

    yaxis: {
      labels: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    tooltip: {
      shared: true,
      intersect: false,

      y: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    legend: {
      show: true,
      position: 'bottom'
    }
  };

  this.chartNotes.barBudgetType = useCountFallback
    ? 'แสดงตามจำนวนรายการ เนื่องจากยอดงบเป็น 0 ทั้งหมด'
    : '';
}

// กราฟแผนงาน //
bindPlanChart(data: any[]) {

  const useCountFallback =
    data.length > 0 &&
    !this.hasAnyNonZero(data, ['Total_Plan', 'Adjust', 'Sum_Withdraw']);

  const map = new Map<string, {
    label: string;
    planOrder: number;
    plan: number;
    adjust: number;
    withdraw: number;
    count: number;
  }>();

  // รวมข้อมูลตามแผนงาน
  data.forEach((x: any) => {

    // A plan name is not a unique identifier.  Grouping by the name caused
    // different plans with the same displayed name to be merged in the chart.
    const planId = x.Plan_Id ?? x.Fk_Plan_Id ?? x.Budget_Plan_Id;
    const label = x.Plan_Name || '-';
    const key = planId !== undefined && planId !== null && planId !== ''
      ? `plan_${planId}`
      : `plan_name_${label}`;

    if (!map.has(key)) {
      map.set(key, {
        label,
        planOrder: Number(x.Plan_Order || x.plan_order || 9999),
        plan: 0,
        adjust: 0,
        withdraw: 0,
        count: 0
      });
    }

    const row = map.get(key)!;

    row.plan += Number(x.Total_Plan || 0);
    row.adjust += Number(x.Adjust || 0);
    row.withdraw += Number(x.Sum_Withdraw || 0);
    row.count += 1;
  });

  // เรียงตาม Plan_Order
  const sortedItems = Array.from(map.entries()).sort(
    (a, b) => a[1].planOrder - b[1].planOrder
  );

  console.table(
    sortedItems.map(([key, value]) => ({
      key,
      planOrder: value.planOrder
    }))
  );

  const labels = sortedItems.map(([, value]) => value.label);
  const rows = sortedItems.map(([_, value]) => value);

  // ==========================
  // เป้าหมายตามไตรมาสปัจจุบัน
  // ==========================

  // เดือนปัจจุบัน
  const currentMonth = new Date().getMonth() + 1;

  // เดือนงบประมาณ (ต.ค.=1 ... ก.ย.=12)
  const fiscalMonth =
    currentMonth >= 10
      ? currentMonth - 9
      : currentMonth + 3;

  // ไตรมาสปัจจุบัน
  const currentQuarter = Math.ceil(fiscalMonth / 3);

  // เป้าหมาย (%)
  const withdrawPercent =
    Number(
      this.dashboardCheck?.[
        `Goals_Withdraw_Tri${currentQuarter}`
      ] || 0
    );

  // ยอดจัดสรรรวม
  const totalAdjust = rows.reduce(
    (sum, x) => sum + Number(x.adjust || 0),
    0
  );

  // เป้าหมายรวมเป็นจำนวนเงิน
  const totalTargetWithdraw =
    totalAdjust * withdrawPercent / 100;

  // เป้าหมายแต่ละแผนงาน
  const targetWithdrawData = rows.map(x => {

    const adjust = Number(x.adjust || 0);

    const ratio =
      totalAdjust > 0
        ? adjust / totalAdjust
        : 0;

    return totalTargetWithdraw * ratio;
  });

  this.comboChart = {
    ...this.comboChart,

    chart: {
      ...this.comboChart.chart,
      type: 'bar',
      stacked: false
    },

    plotOptions: {
      bar: {
        columnWidth: '55%',
        borderRadius: 3
      }
    },

    colors: useCountFallback
      ? ['#0d6efd']
      : [
          '#0d6efd', // จัดสรร
          '#198754', // แผน
          '#ffc107', // เบิกจ่าย
          '#dc3545'  // เป้าหมาย
        ],

    stroke: useCountFallback
      ? {
          width: [0]
        }
      : {
          width: [0, 0, 0, 3],
          curve: 'smooth'
        },

    series: useCountFallback
      ? [
          {
            name: 'จำนวนรายการ',
            type: 'column',
            data: rows.map(x => x.count)
          }
        ]
      : [
          {
            name: 'จัดสรร',
            type: 'column',
            data: rows.map(x => x.adjust)
          },
          {
            name: 'แผน',
            type: 'column',
            data: rows.map(x => x.plan)
          },
          {
            name: 'เบิกจ่าย',
            type: 'column',
            data: rows.map(x => x.withdraw)
          },
          {
            name: `เป้าหมาย ${withdrawPercent}%`,
            type: 'line',
            data: targetWithdrawData
          }
        ],

    xaxis: {
      categories: labels
    },

    dataLabels: {
      enabled: false,

      enabledOnSeries: useCountFallback
        ? [0]
        : [0, 1, 2],

      formatter: (value: number) =>
        value === 0
          ? ''
          : this.formatNumber(value),

      style: {
        fontSize: '11px',
        fontWeight: 'bold',
        colors: ['#1f2937']
      }
    },

    yaxis: {
      labels: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    tooltip: {
      shared: true,
      intersect: false,

      y: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    legend: {
      show: true,
      position: 'bottom'
    }
  };

  this.chartNotes.plan = useCountFallback
    ? 'แสดงตามจำนวนรายการ เนื่องจากยอดงบเป็น 0 ทั้งหมด'
    : '';
}

// กราฟแท่งหน่วยงาน //
bindDepartmentChart(data: any[]) {

  const useCountFallback =
    data.length > 0 &&
    !this.hasAnyNonZero(data, ['Total_Plan', 'Adjust', 'Sum_Withdraw']);

  const map = new Map<string, {
    departmentId: any;
    label: string;
    departmentType: any;
    departmentCostCode: any;
    plan: number;
    adjust: number;
    withdraw: number;
    count: number;
  }>();

  // รวมข้อมูลตามหน่วยงาน
  data.forEach((x: any) => {

    // Department short names are display values and may be repeated.  Keep
    // departments separate by their ID, with the short name used as the label.
    const departmentId = x.Department_Id ?? x.Fk_Department_Id;
    const label = x.Department_Short_Name || x.Department_Name || '-';
    const key = departmentId !== undefined && departmentId !== null && departmentId !== ''
      ? `department_${departmentId}`
      : `department_name_${label}`;

    if (!map.has(key)) {
      map.set(key, {
        departmentId,
        label,
        departmentType: this.getDepartmentField(x, 'Department_Type'),
        departmentCostCode: this.getDepartmentField(x, 'Department_Cost_Code'),
        plan: 0,
        adjust: 0,
        withdraw: 0,
        count: 0
      });
    }

    const row = map.get(key)!;

    row.plan += Number(x.Total_Plan || 0);
    row.adjust += Number(x.Adjust || 0);
    row.withdraw += Number(x.Sum_Withdraw || 0);
    row.count += 1;
  });

  const rows = Array.from(map.values()).sort((left, right) =>
    this.compareDepartmentOrder(left.departmentType, right.departmentType)
    || this.compareDepartmentOrder(left.departmentCostCode, right.departmentCostCode)
    || left.label.localeCompare(right.label, 'th')
  );
  const labels = rows.map(row => row.label);

  // ==========================
  // เป้าหมายตามไตรมาสปัจจุบัน
  // ==========================

  // เดือนปัจจุบัน (1-12)
  const currentMonth = new Date().getMonth() + 1;

  // เดือนงบประมาณ (ต.ค.=1 ... ก.ย.=12)
  const fiscalMonth =
    currentMonth >= 10
      ? currentMonth - 9
      : currentMonth + 3;

  // ไตรมาสปัจจุบัน
  const currentQuarter = Math.ceil(fiscalMonth / 3);

  // เป้าหมายเบิกจ่าย (%)
  const withdrawPercent =
    Number(
      this.dashboardCheck?.[
        `Goals_Withdraw_Tri${currentQuarter}`
      ] || 0
    );

  // ยอดจัดสรรรวมทุกหน่วยงาน
  const totalAdjust = rows.reduce(
    (sum, x) => sum + Number(x.adjust || 0),
    0
  );

  // เป้าหมายรวมเป็นจำนวนเงิน
  const totalTargetWithdraw =
    totalAdjust * withdrawPercent / 100;

  // เป้าหมายแต่ละหน่วยงานตามสัดส่วน Adjust
  const targetWithdrawData = rows.map(x => {

    const adjust = Number(x.adjust || 0);

    const ratio =
      totalAdjust > 0
        ? adjust / totalAdjust
        : 0;

    return totalTargetWithdraw * ratio;
  });

  this.comboChart2 = {
    ...this.comboChart2,

    chart: {
      ...this.comboChart2.chart,
      events: {
        xAxisLabelClick: (_event: any, _chartContext: any, config: any) => {
          this.openDepartmentBudgetModal(rows[config?.labelIndex]?.departmentId);
        },
        dataPointSelection: (_event: any, _chartContext: any, config: any) => {
          this.openDepartmentBudgetModal(rows[config?.dataPointIndex]?.departmentId);
        }
      }
    },

    plotOptions: {
      bar: {
        columnWidth: '25%',
        borderRadius: 3,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last'
      }
    },

    stroke: useCountFallback
      ? {
          width: [0]
        }
      : {
          width: [0, 0, 0, 3],
          curve: 'smooth'
        },

    colors: useCountFallback
      ? ['#0d6efd']
      : [
          '#0d6efd', // จัดสรร
          '#198754', // แผน
          '#ffc107', // เบิกจ่าย
          '#dc3545'  // เป้าหมาย
        ],

    series: useCountFallback
      ? [
          {
            name: 'จำนวนรายการ',
            type: 'column',
            data: rows.map(x => x.count)
          }
        ]
      : [
          {
            name: 'จัดสรร',
            type: 'column',
            data: rows.map(x => x.adjust)
          },
          {
            name: 'แผน',
            type: 'column',
            data: rows.map(x => x.plan)
          },
          {
            name: 'เบิกจ่าย',
            type: 'column',
            data: rows.map(x => x.withdraw)
          },
          {
            name: `เป้าหมาย ${withdrawPercent}%`,
            type: 'line',
            data: targetWithdrawData
          }
        ],

    xaxis: {
      categories: labels
    },

    // ตัวเลขบนแท่งกราฟ
    dataLabels: {
      enabled: false,

      enabledOnSeries: useCountFallback
        ? [0]
        : [0, 1, 2], // ไม่แสดงบนเส้นเป้าหมาย

      formatter: (value: number) => {

        if (Number(value || 0) === 0) {
          return '';
        }

        return useCountFallback
          ? Number(value).toLocaleString('th-TH')
          : this.formatNumber(value);
      },

      style: {
        fontSize: '11px',
        fontWeight: 'bold',
        colors: ['#1f2937']
      }
    },

    // ตัวเลขแกน Y
    yaxis: {
      labels: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    // Tooltip
    tooltip: {
      shared: true,
      intersect: false,

      y: {
        formatter: (value: number) =>
          useCountFallback
            ? Number(value || 0).toLocaleString('th-TH')
            : this.formatNumber(value)
      }
    },

    legend: {
      show: true,
      position: 'bottom'
    }
  };

  this.chartNotes.department = useCountFallback
    ? 'แสดงตามจำนวนรายการ เนื่องจากยอดงบเป็น 0 ทั้งหมด'
    : '';
}

// วงกลมไตรมาส
bindQuarterPieChart(data: any[]) {

  const hasQuarterAmount =
    this.hasAnyNonZero(data, ['Trimas1', 'Trimas2', 'Trimas3', 'Trimas4']);

  const quarterData = hasQuarterAmount
    ? [
        this.sum(data, 'Trimas1'),
        this.sum(data, 'Trimas2'),
        this.sum(data, 'Trimas3'),
        this.sum(data, 'Trimas4')
      ]
    : [];

  const labels = [
    'ไตรมาส 1',
    'ไตรมาส 2',
    'ไตรมาส 3',
    'ไตรมาส 4'
  ];

  this.pieQuarterChart = {
    ...this.pieQuarterChart,

    series: quarterData,

    labels: hasQuarterAmount ? labels : [],

    colors: [
      '#0d6efd',
      '#198754',
      '#ffc107',
      '#dc3545'
    ],

    tooltip: {
      y: {
        formatter: (value: number) =>
          this.formatNumber(value)
      }
    },

    dataLabels: {
      enabled: true,
      formatter: (value: number) =>
        `${value.toFixed(1)}%`,
      style: {
        colors: ['#000000'],
        fontSize: '12px',
        fontWeight: 'bold'
      }
    },

    legend: {
      position: 'bottom'
    }
  };

  this.chartNotes.quarterPie = hasQuarterAmount
    ? ''
    : 'ยังไม่มีข้อมูลยอดรายไตรมาสสำหรับการแสดงกราฟ';
}

// แท่งไตรมาส //
// แท่งไตรมาส //
bindQuarterBarChart(data: any[]) {

  const hasQuarterAmount =
    this.hasAnyNonZero(data, [
      'Trimas1',
      'Trimas2',
      'Trimas3',
      'Trimas4',
      'Sum_Withdraw_Tri1',
      'Sum_Withdraw_Tri2',
      'Sum_Withdraw_Tri3',
      'Sum_Withdraw_Tri4',
      'Sum_Withdraw'
    ]);

  const labels = [
    'ไตรมาส 1',
    'ไตรมาส 2',
    'ไตรมาส 3',
    'ไตรมาส 4'
  ];

  // แผนรายไตรมาส
  const planData = hasQuarterAmount
    ? [
        this.sum(data, 'Trimas1'),
        this.sum(data, 'Trimas2'),
        this.sum(data, 'Trimas3'),
        this.sum(data, 'Trimas4')
      ]
    : [];

  // เบิกจ่ายรายไตรมาส
  let withdrawData = hasQuarterAmount
    ? [
        this.sum(data, 'Sum_Withdraw_Tri1'),
        this.sum(data, 'Sum_Withdraw_Tri2'),
        this.sum(data, 'Sum_Withdraw_Tri3'),
        this.sum(data, 'Sum_Withdraw_Tri4')
      ]
    : [];

  // ยอดรวมบนการ์ดใช้ Sum_Withdraw แต่ยอดรายไตรมาสมาจากข้อมูลรายเดือน
  // บางครั้ง API มีข้อมูลของไตรมาสอนาคตติดมาด้วย จึงใช้เฉพาะถึงไตรมาส
  // ปัจจุบัน และให้ไตรมาสปัจจุบันรับยอดคงเหลือจากยอดรวมโดยตรง
  if (withdrawData.length > 0) {
    const totalWithdraw = this.sum(data, 'Sum_Withdraw');
    const calendarMonth = new Date().getMonth() + 1;
    const fiscalMonth = calendarMonth >= 10 ? calendarMonth - 9 : calendarMonth + 3;
    const currentQuarterIndex = Math.ceil(fiscalMonth / 3) - 1;
    const completedQuarterTotal = withdrawData
      .slice(0, currentQuarterIndex)
      .reduce((sum, amount) => sum + Number(amount || 0), 0);

    withdrawData = withdrawData.map((amount, index) => {
      if (index > currentQuarterIndex) {
        return 0;
      }
      if (index === currentQuarterIndex) {
        return totalWithdraw - completedQuarterTotal;
      }
      return Number(amount || 0);
    });
  }

  // ==========================
  // เป้าหมายแต่ละไตรมาส
  // ==========================

  const quarterPercents = [
    Number(this.dashboardCheck?.Goals_Withdraw_Tri1 || 0),
    Number(this.dashboardCheck?.Goals_Withdraw_Tri2 || 0),
    Number(this.dashboardCheck?.Goals_Withdraw_Tri3 || 0),
    Number(this.dashboardCheck?.Goals_Withdraw_Tri4 || 0)
  ];

  // เป้าหมายเป็นยอดเงินของแต่ละไตรมาส
  const targetData = planData.map((plan, index) =>
    Number(plan || 0) * quarterPercents[index] / 100
  );

  this.barLineChart2 = {
    ...this.barLineChart2,

    plotOptions: {
      bar: {
        columnWidth: '25%',
        borderRadius: 4
      }
    },

    colors: [
      '#0d6efd', // แผน
      '#ffc107', // เบิกจ่าย
      '#dc3545'  // เป้าหมาย
    ],

    stroke: {
      width: [0, 0, 3],
      curve: 'smooth'
    },

    series: hasQuarterAmount
      ? [
          {
            name: 'แผน',
            type: 'column',
            data: planData
          },
          {
            name: 'เบิกจ่าย',
            type: 'column',
            data: withdrawData
          },
          {
            name: 'เป้าหมาย',
            type: 'line',
            data: targetData
          }
        ]
      : [],

    xaxis: {
      categories: hasQuarterAmount ? labels : []
    },

    // ปิดตัวเลขบนกราฟ
    dataLabels: {
      enabled: false
    },

    yaxis: {
      labels: {
        formatter: (value: number) =>
          this.formatNumber(value)
      }
    },

    tooltip: {
      shared: true,
      intersect: false,

      y: {
        formatter: (
          value: number,
          opts?: any
        ) => {

          // เส้นเป้าหมาย
          if (opts?.seriesIndex === 2) {

            const percent =
              quarterPercents[
                opts.dataPointIndex
              ] || 0;

            return `${this.formatNumber(value)} (${percent.toFixed(2)}%)`;
          }

          return this.formatNumber(value);
        }
      }
    },

    legend: {
      show: true,
      position: 'top'
    }
  };

  this.chartNotes.quarterBar = hasQuarterAmount
    ? ''
    : 'ยังไม่มีข้อมูลยอดรายไตรมาสสำหรับการแสดงกราฟ';
}

openDepartmentBudgetModal(departmentId: any): void {
  if (departmentId === undefined || departmentId === null || departmentId === '') return;
  this.ngZone.run(() => {
    this.departmentBudgetLoading = true;
    this.departmentBudgetModal = null;
    setTimeout(() => this.buildDepartmentBudgetModal(departmentId), 50);
  });
}

private buildDepartmentBudgetModal(departmentId: any): void {

  const source = (this.dashboardData || []).filter((row: any) =>
    String(row?.Department_Id ?? row?.Fk_Department_Id) === String(departmentId) &&
    this.budgetGroupFilters[this.getBudgetGroupKey(row)] !== false
  );
  if (!source.length) {
    this.departmentBudgetLoading = false;
    return;
  }

  const useAdjust = this.sum(source, 'Adjust') !== 0;
  const expenseMap = new Map<string, any>();
  source.forEach((row: any) => {
    const name = row?.Expense_Name || row?.Expense_List || row?.Expense_Type_Name || 'ไม่ระบุชื่อค่าใช้จ่าย';
    const key = String(row?.Expense_Id || row?.Fk_Expense_Id || name);
    const item = expenseMap.get(key) || { name, budget: 0, used: 0, withdraw: 0 };
    item.budget += this.toDashboardNumber(useAdjust ? row?.Adjust : row?.Total_Plan);
    item.used += this.toDashboardNumber(row?.Sum_Used);
    item.withdraw += this.toDashboardNumber(row?.Sum_Withdraw);
    expenseMap.set(key, item);
  });

  const items = Array.from(expenseMap.values()).map((item: any) => ({
    ...item,
    usedPercent: item.budget > 0 ? item.used * 100 / item.budget : 0,
    withdrawPercent: item.budget > 0 ? item.withdraw * 100 / item.budget : 0,
    remaining: item.budget - item.withdraw
  }));
  const budget = items.reduce((sum: number, item: any) => sum + item.budget, 0);
  const used = items.reduce((sum: number, item: any) => sum + item.used, 0);
  const withdraw = items.reduce((sum: number, item: any) => sum + item.withdraw, 0);

  const modalData = {
    departmentId,
    departmentName: source[0]?.Department_Name || source[0]?.Department_Short_Name || '-',
    items,
    budget,
    used,
    withdraw,
    remaining: budget - withdraw,
    usedPercent: budget > 0 ? used * 100 / budget : 0,
    withdrawPercent: budget > 0 ? withdraw * 100 / budget : 0,
    remainingPercent: budget > 0 ? (budget - withdraw) * 100 / budget : 0
  };
  // Keep the loading state visible long enough to give clear click feedback.
  setTimeout(() => {
    this.departmentBudgetModal = modalData;
    this.departmentBudgetLoading = false;
  }, 250);
}

closeDepartmentBudgetModal(): void {
  this.departmentBudgetModal = null;
  this.departmentBudgetLoading = false;
}

exportDepartmentBudgetExcel(): void {
  const modal = this.departmentBudgetModal;
  if (!modal) return;
  const rows = modal.items.map((item: any, index: number) => ({
    'ลำดับ': index + 1,
    'ชื่อค่าใช้จ่าย': item.name,
    'งบประมาณ (บาท)': item.budget,
    'ผลการใช้จ่าย (บาท)': item.used,
    '% ใช้จ่าย': item.usedPercent,
    'ผลการเบิกจ่าย (บาท)': item.withdraw,
    '% เบิกจ่าย': item.withdrawPercent,
    'คงเหลือเบิกจ่าย (บาท)': item.remaining
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  // Keep exported amounts and percentages as numeric values, while showing
  // thousands separators and two decimal places in Excel.
  const sheetRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  for (let row = sheetRange.s.r + 1; row <= sheetRange.e.r; row++) {
    for (let column = 2; column <= 7; column++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') {
        cell.z = '#,##0.00';
      }
    }
  }
  worksheet['!cols'] = [
    { wch: 10 }, { wch: 48 }, { wch: 20 }, { wch: 22 },
    { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 22 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'รายละเอียดงบประมาณ');
  XLSX.writeFile(workbook, `รายละเอียดงบประมาณ_${modal.departmentName}.xlsx`);
}

  private getBudgetGroupKey(row: any): string {
    const expenseId = Number(row?.Expense_Id || row?.Fk_Expense_List || row?.Fk_Expense_Id || 0);
    const typeId = Number(row?.Budget_Type_Id || row?.Fk_Budget_Type || 0);
    const text = `${row?.Budget_Type_Name || ''} ${row?.Expense_Type || ''} ${row?.Expense_List || ''}`;

    if (/บุคลากร|เงินเดือน|ค่าจ้างประจำ/.test(text) || typeId === 1) return 'personnel';
    if (this.investmentExpenseIds.includes(expenseId) || /ลงทุน/.test(text) || typeId === 3) return 'investment';
    if (/อุดหนุน/.test(text) || typeId === 4) return 'subsidy';
    if (/รายจ่ายอื่น/.test(text) || typeId === 5) return 'other';
    return 'operating';
  }

  sum(data: any[], field: string): number {
    return data.reduce((s: number, x: any) => s + Number(x[field] || 0), 0);
  }

  getBudgetTypeId(row: any): number {
    const value = row?.Budget_Type_Id ?? row?.Fk_Budget_Type ?? row?.Budget_Type ?? row?.BudgetType_Id;
    return Number(value || 0);
  }

  getExpenseId(row: any): number {
    const value = row?.Expense_Id
      ?? row?.Fk_Expense_List
      ?? row?.Expense_List_Id
      ?? row?.FK_Expense_List
      ?? row?.Fk_Expense_Id;
    return Number(value || 0);
  }

  private isRecurringDashboardRow(row: any): boolean {
    return [1, 2, 4, 5].includes(this.getBudgetTypeId(row))
      && !this.investmentExpenseIds.includes(this.getExpenseId(row));
  }

  private isInvestmentDashboardRow(row: any): boolean {
    return this.getBudgetTypeId(row) === 3
      || this.investmentExpenseIds.includes(this.getExpenseId(row));
  }

  sumByCondition(data: any[], field: string, condition: (row: any) => boolean): number {
    return data
      .filter(condition)
      .reduce((sum: number, row: any) => sum + Number(row[field] || 0), 0);
  }

  private compareDepartmentOrder(left: any, right: any): number {
    const leftValue = String(left ?? '').trim();
    const rightValue = String(right ?? '').trim();

    if (!leftValue && !rightValue) return 0;
    if (!leftValue) return 1;
    if (!rightValue) return -1;

    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return leftValue.localeCompare(rightValue, 'th', { numeric: true });
  }

  private getDepartmentField(item: any, field: string): any {
    if (!item) return undefined;

    const variants = [
      field,
      field.replace(/_/g, ''),
      field.charAt(0).toLowerCase() + field.slice(1),
      field.toLowerCase()
    ];
    return variants
      .map(key => item[key])
      .find(value => value !== null && value !== undefined && value !== '');
  }

  sumByBudgetTypeIds(data: any[], field: string, ids: number[]): number {
    return data
      .filter((row: any) => ids.includes(this.getBudgetTypeId(row)))
      .reduce((s: number, row: any) => s + Number(row[field] || 0), 0);
  }

  hasAnyNonZero(data: any[], fields: string[]): boolean {
    return data.some((row: any) =>
      fields.some((field: string) => Number(row?.[field] || 0) !== 0)
    );
  }

  formatMoney(value: number): string {
    return Number(value || 0).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }


}
