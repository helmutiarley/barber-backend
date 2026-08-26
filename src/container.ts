import { InjectionMode, asClass, asValue, createContainer, type AwilixContainer } from 'awilix';
import type { DataSource } from 'typeorm';
import type { AppConfig } from './config';
import type { Shop } from './entities/shop.entity';
import { AppointmentsController } from './controllers/appointments.controller';
import { AuthController } from './controllers/auth.controller';
import { BarbersController } from './controllers/barbers.controller';
import { CashRegisterController } from './controllers/cash-register.controller';
import { ClientsController } from './controllers/clients.controller';
import { CommissionsController } from './controllers/commissions.controller';
import { ExpensesController } from './controllers/expenses.controller';
import { HealthController } from './controllers/health.controller';
import { PaymentsController } from './controllers/payments.controller';
import { PlatformController } from './controllers/platform.controller';
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
import { ShopsRepository } from './repositories/shops.repository';
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
import { PlatformService } from './services/platform.service';
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

  currentShop: Shop | null;

  healthRepository: HealthRepository;
  shopsRepository: ShopsRepository;
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
  platformService: PlatformService;
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
  platformController: PlatformController;
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

    currentShop: asValue(null),

    healthRepository: asClass(HealthRepository).singleton(),
    shopsRepository: asClass(ShopsRepository).singleton(),

    usersRepository: asClass(UsersRepository).scoped(),
    refreshTokensRepository: asClass(RefreshTokensRepository).scoped(),
    barbersRepository: asClass(BarbersRepository).scoped(),
    barberSchedulesRepository: asClass(BarberSchedulesRepository).scoped(),
    barberBlocksRepository: asClass(BarberBlocksRepository).scoped(),
    servicesRepository: asClass(ServicesRepository).scoped(),
    appointmentsRepository: asClass(AppointmentsRepository).scoped(),
    clientProfilesRepository: asClass(ClientProfilesRepository).scoped(),
    cashRegisterSessionsRepository: asClass(CashRegisterSessionsRepository).scoped(),
    cashMovementsRepository: asClass(CashMovementsRepository).scoped(),
    paymentsRepository: asClass(PaymentsRepository).scoped(),
    expensesRepository: asClass(ExpensesRepository).scoped(),
    commissionRulesRepository: asClass(CommissionRulesRepository).scoped(),
    commissionEntriesRepository: asClass(CommissionEntriesRepository).scoped(),
    commissionPeriodsRepository: asClass(CommissionPeriodsRepository).scoped(),
    commissionAdvancesRepository: asClass(CommissionAdvancesRepository).scoped(),
    productsRepository: asClass(ProductsRepository).scoped(),
    stockAdjustmentsRepository: asClass(StockAdjustmentsRepository).scoped(),
    productSalesRepository: asClass(ProductSalesRepository).scoped(),
    reportsRepository: asClass(ReportsRepository).scoped(),

    healthService: asClass(HealthService).singleton(),
    platformService: asClass(PlatformService).singleton(),
    authService: asClass(AuthService).scoped(),
    usersService: asClass(UsersService).scoped(),
    barbersService: asClass(BarbersService).scoped(),
    availabilityService: asClass(AvailabilityService).scoped(),
    servicesService: asClass(ServicesService).scoped(),
    appointmentsService: asClass(AppointmentsService).scoped(),
    clientsService: asClass(ClientsService).scoped(),
    cashRegisterService: asClass(CashRegisterService).scoped(),
    paymentsService: asClass(PaymentsService).scoped(),
    expensesService: asClass(ExpensesService).scoped(),
    commissionsService: asClass(CommissionsService).scoped(),
    productsService: asClass(ProductsService).scoped(),
    productSalesService: asClass(ProductSalesService).scoped(),
    reportsService: asClass(ReportsService).scoped(),

    healthController: asClass(HealthController).singleton(),
    platformController: asClass(PlatformController).singleton(),
    authController: asClass(AuthController).scoped(),
    usersController: asClass(UsersController).scoped(),
    barbersController: asClass(BarbersController).scoped(),
    servicesController: asClass(ServicesController).scoped(),
    appointmentsController: asClass(AppointmentsController).scoped(),
    clientsController: asClass(ClientsController).scoped(),
    paymentsController: asClass(PaymentsController).scoped(),
    cashRegisterController: asClass(CashRegisterController).scoped(),
    expensesController: asClass(ExpensesController).scoped(),
    commissionsController: asClass(CommissionsController).scoped(),
    productsController: asClass(ProductsController).scoped(),
    productSalesController: asClass(ProductSalesController).scoped(),
    reportsController: asClass(ReportsController).scoped(),
  });

  return container;
}
