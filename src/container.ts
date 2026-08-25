import { InjectionMode, asClass, asValue, createContainer, type AwilixContainer } from 'awilix';
import type { DataSource } from 'typeorm';
import type { AppConfig } from './config';
import { AppointmentsController } from './controllers/appointments.controller';
import { AuthController } from './controllers/auth.controller';
import { BarbersController } from './controllers/barbers.controller';
import { CashRegisterController } from './controllers/cash-register.controller';
import { ClientsController } from './controllers/clients.controller';
import { CommissionsController } from './controllers/commissions.controller';
import { ExpensesController } from './controllers/expenses.controller';
import { HealthController } from './controllers/health.controller';
import { PaymentsController } from './controllers/payments.controller';
import { ProductSalesController } from './controllers/product-sales.controller';
import { ProductsController } from './controllers/products.controller';
import { ReportsController } from './controllers/reports.controller';
import { ServicesController } from './controllers/services.controller';
import { UsersController } from './controllers/users.controller';
import { systemClock, type Clock } from './lib/clock';
import type { Logger } from './lib/logger';
import { AppointmentsRepository } from './repositories/appointments.repository';
import { BarberBlocksRepository } from './repositories/barber-blocks.repository';
import { BarberSchedulesRepository } from './repositories/barber-schedules.repository';
import { BarbersRepository } from './repositories/barbers.repository';
import { CashMovementsRepository } from './repositories/cash-movements.repository';
import { CashRegisterSessionsRepository } from './repositories/cash-register-sessions.repository';
import { ClientProfilesRepository } from './repositories/client-profiles.repository';
import { CommissionAdvancesRepository } from './repositories/commission-advances.repository';
import { CommissionEntriesRepository } from './repositories/commission-entries.repository';
import { CommissionPeriodsRepository } from './repositories/commission-periods.repository';
import { CommissionRulesRepository } from './repositories/commission-rules.repository';
import { ExpensesRepository } from './repositories/expenses.repository';
import { HealthRepository } from './repositories/health.repository';
import { PaymentsRepository } from './repositories/payments.repository';
import { ProductSalesRepository } from './repositories/product-sales.repository';
import { ProductsRepository } from './repositories/products.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { ReportsRepository } from './repositories/reports.repository';
import { ServicesRepository } from './repositories/services.repository';
import { StockAdjustmentsRepository } from './repositories/stock-adjustments.repository';
import { UsersRepository } from './repositories/users.repository';
import { AppointmentsService } from './services/appointments.service';
import { AuthService } from './services/auth.service';
import { AvailabilityService } from './services/availability.service';
import { BarbersService } from './services/barbers.service';
import { CashRegisterService } from './services/cash-register.service';
import { ClientsService } from './services/clients.service';
import { CommissionsService } from './services/commissions.service';
import { ExpensesService } from './services/expenses.service';
import { HealthService } from './services/health.service';
import { PaymentsService } from './services/payments.service';
import { ProductSalesService } from './services/product-sales.service';
import { ProductsService } from './services/products.service';
import { ReportsService } from './services/reports.service';
import { ServicesService } from './services/services.service';
import { UsersService } from './services/users.service';

export interface Cradle {
  config: AppConfig;
  logger: Logger;
  dataSource: DataSource;
  clock: Clock;

  healthRepository: HealthRepository;
  usersRepository: UsersRepository;
  refreshTokensRepository: RefreshTokensRepository;
  barbersRepository: BarbersRepository;
  barberSchedulesRepository: BarberSchedulesRepository;
  barberBlocksRepository: BarberBlocksRepository;
  servicesRepository: ServicesRepository;
  appointmentsRepository: AppointmentsRepository;
  clientProfilesRepository: ClientProfilesRepository;
  cashRegisterSessionsRepository: CashRegisterSessionsRepository;
  cashMovementsRepository: CashMovementsRepository;
  paymentsRepository: PaymentsRepository;
  expensesRepository: ExpensesRepository;
  commissionRulesRepository: CommissionRulesRepository;
  commissionEntriesRepository: CommissionEntriesRepository;
  commissionPeriodsRepository: CommissionPeriodsRepository;
  commissionAdvancesRepository: CommissionAdvancesRepository;
  productsRepository: ProductsRepository;
  stockAdjustmentsRepository: StockAdjustmentsRepository;
  productSalesRepository: ProductSalesRepository;
  reportsRepository: ReportsRepository;

  healthService: HealthService;
  authService: AuthService;
  usersService: UsersService;
  barbersService: BarbersService;
  availabilityService: AvailabilityService;
  servicesService: ServicesService;
  appointmentsService: AppointmentsService;
  clientsService: ClientsService;
  cashRegisterService: CashRegisterService;
  paymentsService: PaymentsService;
  expensesService: ExpensesService;
  commissionsService: CommissionsService;
  productsService: ProductsService;
  productSalesService: ProductSalesService;
  reportsService: ReportsService;

  healthController: HealthController;
  authController: AuthController;
  usersController: UsersController;
  barbersController: BarbersController;
  servicesController: ServicesController;
  appointmentsController: AppointmentsController;
  clientsController: ClientsController;
  paymentsController: PaymentsController;
  cashRegisterController: CashRegisterController;
  expensesController: ExpensesController;
  commissionsController: CommissionsController;
  productsController: ProductsController;
  productSalesController: ProductSalesController;
  reportsController: ReportsController;
}

export interface ContainerDeps {
  config: AppConfig;
  logger: Logger;
  dataSource: DataSource;
  clock?: Clock;
}

export function buildContainer(deps: ContainerDeps): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    config: asValue(deps.config),
    logger: asValue(deps.logger),
    dataSource: asValue(deps.dataSource),
    clock: asValue(deps.clock ?? systemClock),

    healthRepository: asClass(HealthRepository).singleton(),
    usersRepository: asClass(UsersRepository).singleton(),
    refreshTokensRepository: asClass(RefreshTokensRepository).singleton(),
    barbersRepository: asClass(BarbersRepository).singleton(),
    barberSchedulesRepository: asClass(BarberSchedulesRepository).singleton(),
    barberBlocksRepository: asClass(BarberBlocksRepository).singleton(),
    servicesRepository: asClass(ServicesRepository).singleton(),
    appointmentsRepository: asClass(AppointmentsRepository).singleton(),
    clientProfilesRepository: asClass(ClientProfilesRepository).singleton(),
    cashRegisterSessionsRepository: asClass(CashRegisterSessionsRepository).singleton(),
    cashMovementsRepository: asClass(CashMovementsRepository).singleton(),
    paymentsRepository: asClass(PaymentsRepository).singleton(),
    expensesRepository: asClass(ExpensesRepository).singleton(),
    commissionRulesRepository: asClass(CommissionRulesRepository).singleton(),
    commissionEntriesRepository: asClass(CommissionEntriesRepository).singleton(),
    commissionPeriodsRepository: asClass(CommissionPeriodsRepository).singleton(),
    commissionAdvancesRepository: asClass(CommissionAdvancesRepository).singleton(),
    productsRepository: asClass(ProductsRepository).singleton(),
    stockAdjustmentsRepository: asClass(StockAdjustmentsRepository).singleton(),
    productSalesRepository: asClass(ProductSalesRepository).singleton(),
    reportsRepository: asClass(ReportsRepository).singleton(),

    healthService: asClass(HealthService).singleton(),
    authService: asClass(AuthService).singleton(),
    usersService: asClass(UsersService).singleton(),
    barbersService: asClass(BarbersService).singleton(),
    availabilityService: asClass(AvailabilityService).singleton(),
    servicesService: asClass(ServicesService).singleton(),
    appointmentsService: asClass(AppointmentsService).singleton(),
    clientsService: asClass(ClientsService).singleton(),
    cashRegisterService: asClass(CashRegisterService).singleton(),
    paymentsService: asClass(PaymentsService).singleton(),
    expensesService: asClass(ExpensesService).singleton(),
    commissionsService: asClass(CommissionsService).singleton(),
    productsService: asClass(ProductsService).singleton(),
    productSalesService: asClass(ProductSalesService).singleton(),
    reportsService: asClass(ReportsService).singleton(),

    healthController: asClass(HealthController).singleton(),
    authController: asClass(AuthController).singleton(),
    usersController: asClass(UsersController).singleton(),
    barbersController: asClass(BarbersController).singleton(),
    servicesController: asClass(ServicesController).singleton(),
    appointmentsController: asClass(AppointmentsController).singleton(),
    clientsController: asClass(ClientsController).singleton(),
    paymentsController: asClass(PaymentsController).singleton(),
    cashRegisterController: asClass(CashRegisterController).singleton(),
    expensesController: asClass(ExpensesController).singleton(),
    commissionsController: asClass(CommissionsController).singleton(),
    productsController: asClass(ProductsController).singleton(),
    productSalesController: asClass(ProductSalesController).singleton(),
    reportsController: asClass(ReportsController).singleton(),
  });

  return container;
}
