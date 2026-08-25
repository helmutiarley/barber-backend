import 'reflect-metadata';
import 'dotenv/config';
import { DateTime } from 'luxon';
import {
  And,
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  type DataSource,
  type FindOptionsWhere,
} from 'typeorm';
import { loadConfig, type AppConfig } from '../config';
import { Appointment } from '../entities/appointment.entity';
import { BarberBlock } from '../entities/barber-block.entity';
import { BarberSchedule, type TimeOfDay } from '../entities/barber-schedule.entity';
import { Barber } from '../entities/barber.entity';
import { CashMovement } from '../entities/cash-movement.entity';
import { CashRegisterSession } from '../entities/cash-register-session.entity';
import { ClientProfile } from '../entities/client-profile.entity';
import { CommissionAdvance } from '../entities/commission-advance.entity';
import { CommissionEntry } from '../entities/commission-entry.entity';
import { CommissionPeriod } from '../entities/commission-period.entity';
import { CommissionRule } from '../entities/commission-rule.entity';
import type {
  AppointmentStatus,
  CashMovementSource,
  CashMovementType,
  CommissionAppliesTo,
  CommissionBase,
  ExpenseCategory,
  ExpenseKind,
  PaymentMethod,
  StockAdjustmentReason,
  UserRole,
} from '../entities/enums';
import { CARD_PAYMENT_METHODS } from '../entities/enums';
import { Expense } from '../entities/expense.entity';
import { Payment } from '../entities/payment.entity';
import { ProductSale } from '../entities/product-sale.entity';
import { Product } from '../entities/product.entity';
import { Service } from '../entities/service.entity';
import { StockAdjustment } from '../entities/stock-adjustment.entity';
import { User } from '../entities/user.entity';
import { createDataSource } from '../lib/data-source';
import { createLogger } from '../lib/logger';
import { hashPassword } from '../lib/password';
import { shopRangeBounds, toInstant } from '../lib/shop-time';

const SEED_PASSWORD = 'barber123';

interface SeedUser {
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  active?: boolean;

  passwordless?: boolean;
}

const USERS: SeedUser[] = [
  { name: 'Admin', email: 'admin@barber.local', role: 'ADMIN', phone: '+5511999990001' },
  { name: 'Helena Duarte', email: 'helena@barber.local', role: 'ADMIN', phone: '+5511999990002' },

  { name: 'Marcos Rocha', email: 'marcos@barber.local', role: 'MANAGER', phone: '+5511999990010' },
  {
    name: 'Patrícia Lima',
    email: 'patricia@barber.local',
    role: 'MANAGER',
    phone: '+5511999990011',
  },

  { name: 'Rafael Nunes', email: 'rafael@barber.local', role: 'BARBER', phone: '+5511999990020' },
  { name: 'Bruno Costa', email: 'bruno@barber.local', role: 'BARBER', phone: '+5511999990021' },
  { name: 'Carla Mendes', email: 'carla@barber.local', role: 'BARBER', phone: '+5511999990022' },
  { name: 'Diego Souza', email: 'diego@barber.local', role: 'BARBER', phone: '+5511999990023' },
  { name: 'Eduardo Antigo', email: 'eduardo@barber.local', role: 'BARBER', active: false },

  { name: 'Cliente Teste', email: 'cliente@barber.local', role: 'CLIENT', phone: '+5511999990030' },
  { name: 'João Pereira', email: 'joao@barber.local', role: 'CLIENT', phone: '+5511999990031' },
  { name: 'Maria Silva', email: 'maria@barber.local', role: 'CLIENT', phone: '+5511999990032' },
  { name: 'Pedro Alves', email: 'pedro@barber.local', role: 'CLIENT', phone: '+5511999990033' },

  { name: 'Lúcia Ramos', email: 'lucia@barber.local', role: 'CLIENT', active: false },

  { name: 'Balcão Walk-in', email: 'walkin@barber.local', role: 'CLIENT', passwordless: true },
];

interface SeedBarber {
  email: string;
  displayName: string;
  specialties: string[];
  active?: boolean;
}

const BARBERS: SeedBarber[] = [
  { email: 'rafael@barber.local', displayName: 'Rafael', specialties: ['fade', 'barba'] },
  { email: 'bruno@barber.local', displayName: 'Bruno', specialties: ['navalha', 'infantil'] },
  { email: 'carla@barber.local', displayName: 'Carla', specialties: ['pigmentação', 'coloração'] },
  { email: 'diego@barber.local', displayName: 'Diego', specialties: ['fade', 'freestyle'] },

  {
    email: 'eduardo@barber.local',
    displayName: 'Eduardo',
    specialties: ['clássico'],
    active: false,
  },
];

interface SeedSchedule {
  barber: string;

  weekdays: number[];
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  breakStart?: TimeOfDay;
  breakEnd?: TimeOfDay;
}

const WORKING_WEEK = [1, 2, 3, 4, 5, 6];

const SCHEDULES: SeedSchedule[] = [
  {
    barber: 'rafael',
    weekdays: WORKING_WEEK,
    startTime: '09:00:00',
    endTime: '18:00:00',
    breakStart: '12:00:00',
    breakEnd: '13:00:00',
  },
  { barber: 'bruno', weekdays: WORKING_WEEK, startTime: '09:00:00', endTime: '19:00:00' },
  {
    barber: 'carla',
    weekdays: WORKING_WEEK,
    startTime: '09:00:00',
    endTime: '18:00:00',
    breakStart: '12:00:00',
    breakEnd: '13:00:00',
  },
  { barber: 'diego', weekdays: WORKING_WEEK, startTime: '08:00:00', endTime: '17:00:00' },

];

interface SeedBlock {
  barber: string;

  day: number;
  startHour: number;
  endHour: number;
  reason: string;
}

const BLOCKS: SeedBlock[] = [
  { barber: 'rafael', day: 1, startHour: 16, endHour: 17, reason: 'Dentista' },
  { barber: 'carla', day: 5, startHour: 9, endHour: 18, reason: 'Férias' },
  { barber: 'diego', day: 6, startHour: 8, endHour: 17, reason: 'Férias' },
];

interface SeedService {
  name: string;
  price: number;
  durationMinutes: number;
  description: string;
  active?: boolean;
}

const SERVICES: SeedService[] = [
  { name: 'Corte', price: 4500, durationMinutes: 30, description: 'Corte de cabelo tradicional' },
  { name: 'Barba', price: 3000, durationMinutes: 20, description: 'Barba feita na navalha' },
  {
    name: 'Corte + Barba',
    price: 7000,
    durationMinutes: 50,
    description: 'Combo completo com desconto',
  },
  {
    name: 'Corte Infantil',
    price: 3500,
    durationMinutes: 30,
    description: 'Para crianças até 12 anos',
  },
  {
    name: 'Navalhado Premium',
    price: 5500,
    durationMinutes: 40,
    description: 'Acabamento na navalha com toalha quente',
  },
  {
    name: 'Pigmentação de Barba',
    price: 6000,
    durationMinutes: 45,
    description: 'Preenchimento e pigmentação',
  },
  { name: 'Sobrancelha', price: 1500, durationMinutes: 10, description: 'Design de sobrancelha' },

  {
    name: 'Relaxamento',
    price: 8000,
    durationMinutes: 60,
    description: 'Descontinuado',
    active: false,
  },
];

interface SeedClientProfile {

  client: string;
  birthday?: string;

  birthdayThisMonth?: { year: number; day: number };
  preferences?: string;
  internalNotes?: string;
}

const CLIENT_PROFILES: SeedClientProfile[] = [
  {
    client: 'cliente',
    birthdayThisMonth: { year: 1990, day: 12 },
    preferences: 'Máquina 2 na lateral, tesoura em cima',
  },
  {
    client: 'joao',
    birthday: '1988-03-14',
    preferences: 'Risca lateral marcada, sem máquina no topo',
    internalNotes: 'Costuma chegar 15 minutos atrasado — encaixar com folga',
  },
  { client: 'maria', birthday: '1995-07-02', preferences: 'Sobrancelha sempre junto com o corte' },
  {
    client: 'lucia',
    preferences: 'Prefere o fim da tarde',
    internalNotes: 'Conta desativada; histórico mantido para os relatórios',
  },

];

interface SeedAppointment {
  barber: string;
  client: string;
  service: string;

  day: number;
  hour: number;
  minute?: number;
  status: AppointmentStatus;

  bookedBy?: string;
  notes?: string;
  cancelledReason?: string;
}

const APPOINTMENTS: SeedAppointment[] = [

  { barber: 'rafael', client: 'joao', service: 'Corte', day: -7, hour: 10, status: 'completed' },
  { barber: 'rafael', client: 'maria', service: 'Barba', day: -7, hour: 11, status: 'completed' },
  {
    barber: 'bruno',
    client: 'pedro',
    service: 'Corte + Barba',
    day: -7,
    hour: 14,
    status: 'completed',
  },
  {
    barber: 'eduardo',
    client: 'walkin',
    service: 'Corte',
    day: -7,
    hour: 9,
    status: 'completed',
    bookedBy: 'marcos',
    notes: 'Atendido pelo Eduardo antes de sair da equipe',
  },
  {
    barber: 'carla',
    client: 'cliente',
    service: 'Pigmentação de Barba',
    day: -3,
    hour: 9,
    minute: 30,
    status: 'completed',
  },
  {
    barber: 'rafael',
    client: 'lucia',
    service: 'Corte',
    day: -3,
    hour: 15,
    status: 'no_show',
    notes: 'Cliente não compareceu',
  },
  {
    barber: 'bruno',
    client: 'joao',
    service: 'Corte Infantil',
    day: -1,
    hour: 16,
    status: 'cancelled',
    cancelledReason: 'Cliente remarcou por doença',
    bookedBy: 'patricia',
  },
  {
    barber: 'diego',
    client: 'maria',
    service: 'Navalhado Premium',
    day: -1,
    hour: 10,
    status: 'completed',
  },

  { barber: 'rafael', client: 'cliente', service: 'Corte', day: 0, hour: 9, status: 'confirmed' },
  { barber: 'rafael', client: 'joao', service: 'Barba', day: 0, hour: 10, status: 'confirmed' },
  {
    barber: 'bruno',
    client: 'pedro',
    service: 'Corte + Barba',
    day: 0,
    hour: 11,
    status: 'confirmed',
    bookedBy: 'marcos',
    notes: 'Reserva feita na recepção',
  },
  {
    barber: 'carla',
    client: 'maria',
    service: 'Sobrancelha',
    day: 0,
    hour: 14,
    status: 'confirmed',
  },

  { barber: 'rafael', client: 'maria', service: 'Corte', day: 1, hour: 9, status: 'scheduled' },
  {
    barber: 'rafael',
    client: 'pedro',
    service: 'Corte + Barba',
    day: 1,
    hour: 10,
    status: 'scheduled',
  },
  {
    barber: 'bruno',
    client: 'cliente',
    service: 'Navalhado Premium',
    day: 1,
    hour: 9,
    minute: 30,
    status: 'scheduled',
  },
  {
    barber: 'carla',
    client: 'joao',
    service: 'Pigmentação de Barba',
    day: 1,
    hour: 13,
    status: 'scheduled',
  },
  { barber: 'diego', client: 'joao', service: 'Corte', day: 2, hour: 10, status: 'scheduled' },
  {
    barber: 'diego',
    client: 'cliente',
    service: 'Corte Infantil',
    day: 2,
    hour: 11,
    status: 'scheduled',
    bookedBy: 'patricia',
  },
  { barber: 'rafael', client: 'maria', service: 'Barba', day: 3, hour: 15, status: 'scheduled' },
];

type SeedDrawer = 'open' | 'closed';

interface SeedPayment {

  appointment: { barber: string; day: number; hour: number; minute?: number };

  items: { method: PaymentMethod; amountCents: number }[];
  drawer?: SeedDrawer;

  receivedBy: string;
}

const PAYMENTS: SeedPayment[] = [
  {
    appointment: { barber: 'rafael', day: -7, hour: 10 },
    items: [{ method: 'cash', amountCents: 4500 }],
    drawer: 'closed',
    receivedBy: 'marcos',
  },
  {
    appointment: { barber: 'rafael', day: -7, hour: 11 },
    items: [{ method: 'pix', amountCents: 3000 }],
    receivedBy: 'marcos',
  },
  {
    appointment: { barber: 'bruno', day: -7, hour: 14 },
    items: [{ method: 'credit', amountCents: 7000 }],
    receivedBy: 'patricia',
  },
  {
    appointment: { barber: 'eduardo', day: -7, hour: 9 },
    items: [{ method: 'cash', amountCents: 4500 }],
    drawer: 'closed',
    receivedBy: 'marcos',
  },
  {
    appointment: { barber: 'carla', day: -3, hour: 9, minute: 30 },
    items: [{ method: 'debit', amountCents: 6000 }],
    receivedBy: 'patricia',
  },

  {
    appointment: { barber: 'diego', day: -1, hour: 10 },
    items: [
      { method: 'cash', amountCents: 3000 },
      { method: 'credit', amountCents: 2500 },
    ],
    drawer: 'closed',
    receivedBy: 'marcos',
  },

  {
    appointment: { barber: 'rafael', day: 0, hour: 9 },
    items: [{ method: 'cash', amountCents: 4500 }],
    drawer: 'open',
    receivedBy: 'marcos',
  },
];

interface SeedManualMovement {
  drawer: SeedDrawer;
  type: CashMovementType;
  source: CashMovementSource;
  amountCents: number;

  description: string;
  createdBy: string;
}

const MANUAL_MOVEMENTS: SeedManualMovement[] = [
  {
    drawer: 'closed',
    type: 'out',
    source: 'withdrawal',
    amountCents: 10_000,
    description: 'Sangria para o cofre',
    createdBy: 'marcos',
  },
  {
    drawer: 'open',
    type: 'in',
    source: 'deposit',
    amountCents: 5000,
    description: 'Troco trazido do cofre',
    createdBy: 'patricia',
  },
  {
    drawer: 'open',
    type: 'out',
    source: 'withdrawal',
    amountCents: 2000,
    description: 'Compra de material de limpeza',
    createdBy: 'marcos',
  },
];

const CLOSED_SESSION_SHORTFALL = 150;

interface SeedExpense {

  description: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amountCents: number;

  dueInDays?: number;
  paymentMethod?: PaymentMethod;

  paidDaysAgo?: number;
  recurring?: boolean;
  createdBy: string;
}

const EXPENSES: SeedExpense[] = [
  {
    description: 'Aluguel do ponto',
    category: 'rent',
    kind: 'fixed',
    amountCents: 250_000,
    dueInDays: -5,
    paymentMethod: 'pix',
    paidDaysAgo: 5,
    recurring: true,
    createdBy: 'helena',
  },
  {
    description: 'Salários da equipe',
    category: 'salaries',
    kind: 'fixed',
    amountCents: 800_000,
    dueInDays: 10,
    recurring: true,
    createdBy: 'helena',
  },
  {
    description: 'Conta de luz',
    category: 'utilities',
    kind: 'fixed',
    amountCents: 43_215,
    dueInDays: 3,
    createdBy: 'marcos',
  },
  {
    description: 'Troca da cadeira 2',
    category: 'maintenance',
    kind: 'variable',
    amountCents: 68_000,
    dueInDays: -4,
    createdBy: 'marcos',
  },
  {
    description: 'Pomadas e shampoos',
    category: 'products',
    kind: 'variable',
    amountCents: 32_400,
    dueInDays: -2,
    paymentMethod: 'debit',
    paidDaysAgo: 2,
    createdBy: 'patricia',
  },
  {
    description: 'Café e copos descartáveis',
    category: 'supplies',
    kind: 'variable',
    amountCents: 7500,
    paymentMethod: 'cash',
    paidDaysAgo: 0,
    createdBy: 'patricia',
  },
];

interface SeedCommissionRule {

  barber: string | null;

  service: string | null;
  rate: number;
  base: CommissionBase;

  appliesTo?: CommissionAppliesTo;
  active?: boolean;
}

const COMMISSION_RULES: SeedCommissionRule[] = [
  { barber: null, service: null, rate: 0.4, base: 'gross' },

  { barber: 'rafael', service: null, rate: 0.5, base: 'gross' },

  { barber: null, service: 'Pigmentação de Barba', rate: 0.45, base: 'net' },

  { barber: 'carla', service: 'Pigmentação de Barba', rate: 0.55, base: 'net' },

  { barber: 'diego', service: null, rate: 0.35, base: 'gross', active: false },

  { barber: null, service: null, rate: 0.1, base: 'gross', appliesTo: 'products' },
];

interface SeedCommissionEntry {

  appointment: { barber: string; day: number; hour: number; minute?: number };

  rule: { barber: string | null; service: string | null };
}

const COMMISSION_ENTRIES: SeedCommissionEntry[] = [
  {
    appointment: { barber: 'rafael', day: -7, hour: 10 },
    rule: { barber: 'rafael', service: null },
  },
  {
    appointment: { barber: 'rafael', day: -7, hour: 11 },
    rule: { barber: 'rafael', service: null },
  },
  { appointment: { barber: 'bruno', day: -7, hour: 14 }, rule: { barber: null, service: null } },
  { appointment: { barber: 'eduardo', day: -7, hour: 9 }, rule: { barber: null, service: null } },
  {
    appointment: { barber: 'carla', day: -3, hour: 9, minute: 30 },
    rule: { barber: 'carla', service: 'Pigmentação de Barba' },
  },

  { appointment: { barber: 'diego', day: -1, hour: 10 }, rule: { barber: null, service: null } },
];

interface SeedCommissionAdvance {
  barber: string;

  notes: string;
  amountCents: number;
  daysAgo: number;
  paymentMethod: PaymentMethod;

  drawer?: SeedDrawer;
  createdBy: string;
}

const COMMISSION_ADVANCES: SeedCommissionAdvance[] = [
  {
    barber: 'rafael',
    notes: 'Vale da quinzena passada',

    amountCents: 1500,
    daysAgo: 8,

    paymentMethod: 'pix',
    createdBy: 'marcos',
  },
  {
    barber: 'carla',
    notes: 'Vale para material de pigmentação',
    amountCents: 5000,
    daysAgo: 0,
    paymentMethod: 'cash',
    drawer: 'open',
    createdBy: 'patricia',
  },
];

interface SeedCommissionPeriod {
  barber: string;

  startsDaysAgo: number;
  endsDaysAgo: number;

  paidWith?: { paymentMethod: PaymentMethod; drawer?: SeedDrawer };
  closedBy: string;
}

const COMMISSION_PERIODS: SeedCommissionPeriod[] = [
  {
    barber: 'rafael',
    startsDaysAgo: 10,
    endsDaysAgo: 6,
    paidWith: { paymentMethod: 'cash', drawer: 'open' },
    closedBy: 'admin',
  },
  { barber: 'bruno', startsDaysAgo: 10, endsDaysAgo: 6, closedBy: 'admin' },
];

interface SeedStockAdjustment {
  delta: number;
  reason: StockAdjustmentReason;

  notes: string;
  daysAgo: number;
  createdBy: string;
}

interface SeedProduct {
  name: string;
  description: string;
  priceCents: number;
  costCents: number;
  lowStockThreshold: number;
  active?: boolean;

  adjustments: SeedStockAdjustment[];
}

const PRODUCTS: SeedProduct[] = [
  {
    name: 'Pomada Modeladora',
    description: 'Fixação forte, acabamento seco',
    priceCents: 3500,
    costCents: 1800,
    lowStockThreshold: 4,
    adjustments: [
      {
        delta: 24,
        reason: 'purchase',
        notes: 'Compra mensal com o distribuidor',
        daysAgo: 12,
        createdBy: 'marcos',
      },
      {
        delta: -1,
        reason: 'loss',
        notes: 'Pote caiu e quebrou na bancada',
        daysAgo: 4,
        createdBy: 'patricia',
      },
    ],
  },
  {
    name: 'Óleo para Barba',
    description: 'Hidratação diária com óleo de argan',
    priceCents: 3900,
    costCents: 1900,
    lowStockThreshold: 3,
    adjustments: [
      {
        delta: 6,
        reason: 'purchase',
        notes: 'Reposição pedida por telefone',
        daysAgo: 9,
        createdBy: 'marcos',
      },
    ],
  },
  {

    name: 'Shampoo Anticaspa',
    description: 'Uso semanal, 250ml',
    priceCents: 4200,
    costCents: 2400,
    lowStockThreshold: 6,
    adjustments: [
      {
        delta: 12,
        reason: 'purchase',
        notes: 'Caixa fechada do fornecedor',
        daysAgo: 25,
        createdBy: 'admin',
      },
      {
        delta: -6,
        reason: 'correction',
        notes: 'Contagem de prateleira: seis frascos a menos que o sistema',
        daysAgo: 2,
        createdBy: 'admin',
      },
    ],
  },
  {
    name: 'Cera Modeladora Matte',
    description: 'Fixação média, sem brilho',
    priceCents: 3200,
    costCents: 1600,
    lowStockThreshold: 3,
    adjustments: [
      {
        delta: 10,
        reason: 'purchase',
        notes: 'Primeiro pedido da linha matte',
        daysAgo: 15,
        createdBy: 'marcos',
      },
    ],
  },
  {

    name: 'Minoxidil',
    description: 'Tratamento para crescimento de barba',
    priceCents: 8900,
    costCents: 5200,
    lowStockThreshold: 1,
    adjustments: [],
  },
  {
    name: 'Balm Pós-Barba',
    description: 'Linha descontinuada',
    priceCents: 3300,
    costCents: 1500,
    lowStockThreshold: 0,
    active: false,
    adjustments: [
      {
        delta: 5,
        reason: 'purchase',
        notes: 'Última compra antes de sair de linha',
        daysAgo: 60,
        createdBy: 'admin',
      },

      {
        delta: -5,
        reason: 'loss',
        notes: 'Sobra descartada ao encerrar a linha',
        daysAgo: 30,
        createdBy: 'admin',
      },
    ],
  },
];

interface SeedProductSale {

  items: { product: string; quantity: number }[];
  method: PaymentMethod;
  drawer?: SeedDrawer;

  soldBy?: string;
  client?: string;

  voidedReason?: string;
  createdBy: string;
}

const PRODUCT_SALES: SeedProductSale[] = [
  {
    items: [
      { product: 'Pomada Modeladora', quantity: 2 },
      { product: 'Óleo para Barba', quantity: 1 },
    ],
    method: 'cash',
    drawer: 'open',
    soldBy: 'rafael',
    client: 'joao',
    createdBy: 'marcos',
  },
  {
    items: [{ product: 'Cera Modeladora Matte', quantity: 1 }],
    method: 'credit',
    createdBy: 'patricia',
  },
  {
    items: [{ product: 'Óleo para Barba', quantity: 1 }],
    method: 'cash',
    drawer: 'open',
    soldBy: 'carla',
    voidedReason: 'Cliente desistiu na hora de pagar',
    createdBy: 'patricia',
  },
];

function slot(day: number, hour: number, minute: number, zone: string): Date {
  return toInstant(shopDay(day, zone), `${pad(hour)}:${pad(minute)}`, zone);
}

function shopDay(day: number, zone: string): string {
  return DateTime.now().setZone(zone).startOf('day').plus({ days: day }).toFormat('yyyy-MM-dd');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function appointmentKey(barber: string, day: number, hour: number, minute: number): string {
  return `${barber}:${day}:${hour}:${minute}`;
}

function ruleKey(
  barber: string | null,
  service: string | null,
  appliesTo: CommissionAppliesTo = 'services',
): string {
  return `${appliesTo}:${barber ?? '*'}:${service ?? '*'}`;
}

function shopDate(day: number, zone: string): string {
  return DateTime.now().setZone(zone).plus({ days: day }).toFormat('yyyy-MM-dd');
}

function birthdayThisMonth(year: number, day: number, zone: string): string {
  const month = DateTime.now().setZone(zone).toFormat('MM');

  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

async function upsertUser(
  dataSource: DataSource,
  seed: SeedUser,
  passwordHash: string,
): Promise<User> {
  const repository = dataSource.getRepository(User);
  const existing = await repository.findOneBy({ email: seed.email });

  return repository.save({
    ...(existing ? { id: existing.id } : {}),
    name: seed.name,
    email: seed.email,
    phone: seed.phone ?? null,
    role: seed.role,
    active: seed.active ?? true,
    passwordHash: seed.passwordless ? null : passwordHash,
  });
}

async function upsertBarber(
  dataSource: DataSource,
  seed: SeedBarber,
  userId: string,
): Promise<Barber> {
  const repository = dataSource.getRepository(Barber);
  const existing = await repository.findOneBy({ userId });

  return repository.save({
    ...(existing ? { id: existing.id } : {}),
    userId,
    displayName: seed.displayName,
    specialties: seed.specialties,
    active: seed.active ?? true,
  });
}

async function upsertService(dataSource: DataSource, seed: SeedService): Promise<Service> {
  const repository = dataSource.getRepository(Service);
  const existing = await repository.findOneBy({ name: seed.name });

  return repository.save({
    ...(existing ? { id: existing.id } : {}),
    ...seed,
    active: seed.active ?? true,
  });
}

async function upsertProduct(dataSource: DataSource, seed: SeedProduct): Promise<Product> {
  const repository = dataSource.getRepository(Product);
  const existing = await repository.findOneBy({ name: seed.name });

  return repository.save({
    ...(existing ? { id: existing.id } : { stockQuantity: 0 }),
    name: seed.name,
    description: seed.description,
    price: seed.priceCents,
    cost: seed.costCents,
    lowStockThreshold: seed.lowStockThreshold,
    active: seed.active ?? true,
  });
}

async function upsertStockAdjustment(
  dataSource: DataSource,
  seed: SeedStockAdjustment,
  productId: string,
  createdBy: string,
  zone: string,
): Promise<void> {
  const repository = dataSource.getRepository(StockAdjustment);
  if (await repository.findOneBy({ productId, notes: seed.notes })) return;

  const products = dataSource.getRepository(Product);
  const product = await products.findOneByOrFail({ id: productId });
  const resultingQuantity = product.stockQuantity + seed.delta;

  await products.update({ id: productId }, { stockQuantity: resultingQuantity });
  await repository.save(
    repository.create({
      productId,
      delta: seed.delta,
      reason: seed.reason,
      resultingQuantity,
      notes: seed.notes,
      createdBy,
      createdAt: slot(-seed.daysAgo, 11, 0, zone),
    }),
  );
}

async function seedProductSale(
  dataSource: DataSource,
  seed: SeedProductSale,
  context: {
    products: Map<string, Product>;
    barberId: string | null;
    clientId: string | null;
    createdBy: string;
    sessionId: string | null;
    cardFeeRates: AppConfig['cardFeeRates'];
    rule: CommissionRule | null;
    createdAt: Date;
  },
): Promise<void> {
  const sales = dataSource.getRepository(ProductSale);

  const key: FindOptionsWhere<ProductSale> = seed.voidedReason
    ? { voidReason: seed.voidedReason }
    : { productId: context.products.get(seed.items[0].product)!.id, voidedAt: IsNull() };

  if (await sales.findOneBy(key)) return;

  const lines = seed.items.map((item) => {
    const product = context.products.get(item.product)!;

    return { product, quantity: item.quantity, total: product.price * item.quantity };
  });

  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const cardFee = CARD_PAYMENT_METHODS.includes(seed.method)
    ? Math.round(total * context.cardFeeRates[seed.method as 'debit' | 'credit'])
    : 0;
  const voided = seed.voidedReason !== undefined;

  const payment = await dataSource.getRepository(Payment).save(
    dataSource.getRepository(Payment).create({
      appointmentId: null,
      amount: total,
      method: seed.method,
      cardFee,
      netAmount: total - cardFee,
      cashRegisterSessionId: context.sessionId,
      receivedBy: context.createdBy,
      paidAt: context.createdAt,
      ...(voided
        ? {
            voidedAt: context.createdAt,
            voidedBy: context.createdBy,
            voidReason: seed.voidedReason,
          }
        : {}),
    }),
  );

  if (context.sessionId) {
    await upsertMovement(
      dataSource,
      {
        sessionId: context.sessionId,
        type: 'in',
        source: 'payment',
        amount: total,
        paymentId: payment.id,
        createdBy: context.createdBy,
      },
      { paymentId: payment.id, type: 'in' },
    );

    if (voided) {
      await upsertMovement(
        dataSource,
        {
          sessionId: context.sessionId,
          type: 'out',
          source: 'payment',
          amount: total,
          paymentId: payment.id,
          description: 'Voided sale',
          createdBy: context.createdBy,
        },
        { paymentId: payment.id, type: 'out' },
      );
    }
  }

  for (const line of lines) {
    const sale = await sales.save(
      sales.create({
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.product.price,
        total: line.total,
        soldByBarberId: context.barberId,
        clientId: context.clientId,
        paymentId: payment.id,
        createdBy: context.createdBy,
        createdAt: context.createdAt,
        ...(voided
          ? {
              voidedAt: context.createdAt,
              voidedBy: context.createdBy,
              voidReason: seed.voidedReason,
            }
          : {}),
      }),
    );

    if (!voided) {
      await dataSource
        .getRepository(Product)
        .decrement({ id: line.product.id }, 'stockQuantity', line.quantity);
    }

    if (!context.barberId || !context.rule) continue;

    const baseAmount = voided ? 0 : line.total;

    await dataSource.getRepository(CommissionEntry).save(
      dataSource.getRepository(CommissionEntry).create({
        barberId: context.barberId,
        productSaleId: sale.id,
        ruleId: context.rule.id,
        rate: context.rule.rate,
        base: context.rule.base,
        baseAmount,
        amount: Math.round(baseAmount * context.rule.rate),
        createdAt: context.createdAt,
      }),
    );
  }
}

async function upsertClientProfile(
  dataSource: DataSource,
  seed: SeedClientProfile,
  userId: string,
  zone: string,
): Promise<void> {
  const repository = dataSource.getRepository(ClientProfile);
  const existing = await repository.findOneBy({ userId });

  await repository.save({
    ...(existing ? { id: existing.id } : {}),
    userId,
    birthday: seed.birthdayThisMonth
      ? birthdayThisMonth(seed.birthdayThisMonth.year, seed.birthdayThisMonth.day, zone)
      : (seed.birthday ?? null),
    preferences: seed.preferences ?? null,
    internalNotes: seed.internalNotes ?? null,
  });
}

async function upsertSchedule(
  dataSource: DataSource,
  barberId: string,
  weekday: number,
  seed: SeedSchedule,
): Promise<void> {
  const repository = dataSource.getRepository(BarberSchedule);
  const existing = await repository.findOneBy({ barberId, weekday });

  await repository.save({
    ...(existing ? { id: existing.id } : {}),
    barberId,
    weekday,
    startTime: seed.startTime,
    endTime: seed.endTime,
    breakStart: seed.breakStart ?? null,
    breakEnd: seed.breakEnd ?? null,
  });
}

async function upsertBlock(
  dataSource: DataSource,
  barberId: string,
  startsAt: Date,
  endsAt: Date,
  reason: string,
): Promise<void> {
  const repository = dataSource.getRepository(BarberBlock);
  const existing = await repository.findOneBy({ barberId, startsAt });
  if (existing) return;

  await repository.save(repository.create({ barberId, startsAt, endsAt, reason }));
}

async function upsertAppointment(
  dataSource: DataSource,
  data: Partial<Appointment>,
): Promise<Appointment> {
  const repository = dataSource.getRepository(Appointment);
  const existing = await repository.findOneBy({
    barberId: data.barberId,
    startsAt: data.startsAt,
  });
  if (existing) return existing;

  return repository.save(repository.create(data));
}

async function upsertClosedSession(
  dataSource: DataSource,
  openedAt: Date,
  closedAt: Date,
  openingBalance: number,
  staffId: string,
): Promise<CashRegisterSession> {
  const repository = dataSource.getRepository(CashRegisterSession);
  const existing = await repository.findOneBy({ openedAt });
  if (existing) return existing;

  return repository.save(
    repository.create({
      status: 'closed',
      openedBy: staffId,
      openedAt,
      openingBalance,
      closedBy: staffId,
      closedAt,
      notes: 'Fechamento do dia anterior',
    }),
  );
}

async function upsertOpenSession(
  dataSource: DataSource,
  openedAt: Date,
  openingBalance: number,
  staffId: string,
): Promise<CashRegisterSession> {
  const repository = dataSource.getRepository(CashRegisterSession);
  const existing = await repository.findOneBy({ status: 'open' });
  if (existing) return existing;

  return repository.save(
    repository.create({ status: 'open', openedBy: staffId, openedAt, openingBalance }),
  );
}

async function upsertPayment(
  dataSource: DataSource,
  data: Partial<Payment>,
  key: FindOptionsWhere<Payment>,
): Promise<Payment> {
  const repository = dataSource.getRepository(Payment);
  const existing = await repository.findOneBy(key);
  if (existing) return existing;

  return repository.save(repository.create(data));
}

async function upsertExpense(dataSource: DataSource, data: Partial<Expense>): Promise<Expense> {
  const repository = dataSource.getRepository(Expense);
  const existing = await repository.findOneBy({ description: data.description });
  if (existing) return existing;

  return repository.save(repository.create(data));
}

async function upsertCommissionRule(
  dataSource: DataSource,
  seed: SeedCommissionRule,
  barberId: string | null,
  serviceId: string | null,
): Promise<CommissionRule> {
  const repository = dataSource.getRepository(CommissionRule);
  const scope: FindOptionsWhere<CommissionRule> = {
    barberId: barberId ?? IsNull(),
    serviceId: serviceId ?? IsNull(),
    appliesTo: seed.appliesTo ?? 'services',
  };

  const existing =
    (await repository.findOneBy({ ...scope, active: true })) ?? (await repository.findOneBy(scope));

  return repository.save({
    ...(existing ? { id: existing.id } : {}),
    barberId,
    serviceId,
    appliesTo: seed.appliesTo ?? 'services',
    rate: seed.rate,
    base: seed.base,
    active: seed.active ?? true,
  });
}

async function upsertCommissionEntry(
  dataSource: DataSource,
  appointmentId: string,
  data: Omit<Partial<CommissionEntry>, 'appointmentId'>,
): Promise<void> {
  const repository = dataSource.getRepository(CommissionEntry);
  const existing = await repository.findOneBy({ appointmentId });
  if (existing) return;

  await repository.save(repository.create({ ...data, appointmentId }));
}

async function commissionBaseAmount(
  dataSource: DataSource,
  appointment: Appointment,
  base: CommissionBase,
): Promise<number> {
  if (base === 'gross') return appointment.price;

  const payments = await dataSource
    .getRepository(Payment)
    .findBy({ appointmentId: appointment.id, voidedAt: IsNull() });

  return payments.length
    ? payments.reduce((total, payment) => total + payment.netAmount, 0)
    : appointment.price;
}

async function upsertCommissionAdvance(
  dataSource: DataSource,
  data: Partial<CommissionAdvance> & { notes: string },
): Promise<CommissionAdvance> {
  const repository = dataSource.getRepository(CommissionAdvance);
  const existing = await repository.findOneBy({ notes: data.notes });
  if (existing) return existing;

  return repository.save(repository.create(data));
}

async function closeSeedPeriod(
  dataSource: DataSource,
  seed: SeedCommissionPeriod,
  barberId: string,
  closedById: string,
  zone: string,
): Promise<CommissionPeriod | null> {
  const periods = dataSource.getRepository(CommissionPeriod);
  const existing = await periods.findOneBy({ barberId });
  if (existing) return existing;

  const startsOn = shopDay(-seed.startsDaysAgo, zone);
  const endsOn = shopDay(-seed.endsDaysAgo, zone);
  const { start, end } = shopRangeBounds(startsOn, endsOn, zone);

  const entries = await dataSource.getRepository(CommissionEntry).findBy({
    barberId,
    periodId: IsNull(),
    createdAt: And(MoreThanOrEqual(start), LessThan(end)),
  });
  const advances = await dataSource.getRepository(CommissionAdvance).findBy({
    barberId,
    periodId: IsNull(),
    createdAt: And(MoreThanOrEqual(start), LessThan(end)),
  });

  if (entries.length === 0 && advances.length === 0) return null;

  const totalEntries = entries.reduce((total, entry) => total + entry.amount, 0);
  const totalAdvances = advances.reduce((total, advance) => total + advance.amount, 0);

  const period = await periods.save(
    periods.create({
      barberId,
      startsOn,
      endsOn,
      status: 'closed',
      totalEntries,
      totalAdvances,
      totalDue: totalEntries - totalAdvances,
      closedBy: closedById,

      closedAt: slot(-seed.endsDaysAgo + 1, 19, 0, zone),
    }),
  );

  if (entries.length > 0) {
    await dataSource
      .getRepository(CommissionEntry)
      .update({ id: In(entries.map((entry) => entry.id)) }, { periodId: period.id });
  }
  if (advances.length > 0) {
    await dataSource
      .getRepository(CommissionAdvance)
      .update({ id: In(advances.map((advance) => advance.id)) }, { periodId: period.id });
  }

  return period;
}

async function upsertMovement(
  dataSource: DataSource,
  data: Partial<CashMovement>,
  key: FindOptionsWhere<CashMovement>,
): Promise<void> {
  const repository = dataSource.getRepository(CashMovement);
  const existing = await repository.findOneBy(key);
  if (existing) return;

  await repository.save(repository.create(data));
}

async function snapshotClosedSession(
  dataSource: DataSource,
  session: CashRegisterSession,
): Promise<void> {
  const repository = dataSource.getRepository(CashRegisterSession);
  const movements = await dataSource.getRepository(CashMovement).findBy({ sessionId: session.id });

  const expected = movements.reduce(
    (total, movement) => total + (movement.type === 'in' ? movement.amount : -movement.amount),
    session.openingBalance,
  );

  await repository.save({
    id: session.id,
    expectedBalance: expected,
    countedBalance: expected - CLOSED_SESSION_SHORTFALL,
    difference: -CLOSED_SESSION_SHORTFALL,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  if (config.nodeEnv === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const dataSource = createDataSource(config, { logging: config.logLevel === 'trace' });
  await dataSource.initialize();

  try {

    const passwordHash = await hashPassword(SEED_PASSWORD);

    const usersByEmail = new Map<string, User>();
    for (const seed of USERS) {
      usersByEmail.set(seed.email, await upsertUser(dataSource, seed, passwordHash));
    }

    const barbersByKey = new Map<string, Barber>();
    for (const seed of BARBERS) {
      const user = usersByEmail.get(seed.email)!;
      barbersByKey.set(seed.email.split('@')[0], await upsertBarber(dataSource, seed, user.id));
    }

    for (const seed of SCHEDULES) {
      const barber = barbersByKey.get(seed.barber)!;
      for (const weekday of seed.weekdays) {
        await upsertSchedule(dataSource, barber.id, weekday, seed);
      }
    }

    for (const seed of BLOCKS) {
      const barber = barbersByKey.get(seed.barber)!;

      await upsertBlock(
        dataSource,
        barber.id,
        slot(seed.day, seed.startHour, 0, config.shopTimezone),
        slot(seed.day, seed.endHour, 0, config.shopTimezone),
        seed.reason,
      );
    }

    for (const seed of CLIENT_PROFILES) {
      const user = usersByEmail.get(`${seed.client}@barber.local`)!;
      await upsertClientProfile(dataSource, seed, user.id, config.shopTimezone);
    }

    const servicesByName = new Map<string, Service>();
    for (const seed of SERVICES) {
      servicesByName.set(seed.name, await upsertService(dataSource, seed));
    }

    const appointmentsByKey = new Map<string, Appointment>();
    for (const seed of APPOINTMENTS) {
      const barber = barbersByKey.get(seed.barber)!;
      const client = usersByEmail.get(`${seed.client}@barber.local`)!;
      const service = servicesByName.get(seed.service)!;
      const bookedBy = usersByEmail.get(`${seed.bookedBy ?? seed.client}@barber.local`)!;

      const startsAt = slot(seed.day, seed.hour, seed.minute ?? 0, config.shopTimezone);
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

      const appointment = await upsertAppointment(dataSource, {
        clientId: client.id,
        barberId: barber.id,
        serviceId: service.id,
        status: seed.status,
        startsAt,
        endsAt,

        price: service.price,
        durationMinutes: service.durationMinutes,
        notes: seed.notes ?? null,
        cancelledReason: seed.cancelledReason ?? null,
        cancelledBy: seed.cancelledReason ? bookedBy.id : null,
        createdBy: bookedBy.id,
      });

      appointmentsByKey.set(
        appointmentKey(seed.barber, seed.day, seed.hour, seed.minute ?? 0),
        appointment,
      );
    }

    const manager = usersByEmail.get('marcos@barber.local')!;
    const drawers: Record<SeedDrawer, CashRegisterSession> = {
      closed: await upsertClosedSession(
        dataSource,
        slot(-1, 9, 0, config.shopTimezone),
        slot(-1, 19, 0, config.shopTimezone),
        20_000,
        manager.id,
      ),
      open: await upsertOpenSession(
        dataSource,
        slot(0, 9, 0, config.shopTimezone),
        15_000,
        manager.id,
      ),
    };

    for (const seed of PAYMENTS) {
      const { barber, day, hour, minute = 0 } = seed.appointment;
      const appointment = appointmentsByKey.get(appointmentKey(barber, day, hour, minute))!;
      const receivedBy = usersByEmail.get(`${seed.receivedBy}@barber.local`)!;

      for (const item of seed.items) {
        const session = item.method === 'cash' ? drawers[seed.drawer ?? 'open'] : null;
        const cardFee = CARD_PAYMENT_METHODS.includes(item.method)
          ? Math.round(item.amountCents * config.cardFeeRates[item.method as 'debit' | 'credit'])
          : 0;

        const payment = await upsertPayment(
          dataSource,
          {
            appointmentId: appointment.id,
            amount: item.amountCents,
            method: item.method,
            cardFee,
            netAmount: item.amountCents - cardFee,
            cashRegisterSessionId: session?.id ?? null,
            receivedBy: receivedBy.id,
            paidAt: appointment.startsAt,
          },

          { appointmentId: appointment.id, method: item.method },
        );

        if (!session) continue;

        await upsertMovement(
          dataSource,
          {
            sessionId: session.id,
            type: 'in',
            source: 'payment',
            amount: item.amountCents,
            paymentId: payment.id,
            createdBy: receivedBy.id,
          },
          { paymentId: payment.id, type: 'in' },
        );
      }
    }

    for (const seed of MANUAL_MOVEMENTS) {
      const session = drawers[seed.drawer];
      const createdBy = usersByEmail.get(`${seed.createdBy}@barber.local`)!;

      await upsertMovement(
        dataSource,
        {
          sessionId: session.id,
          type: seed.type,
          source: seed.source,
          amount: seed.amountCents,
          description: seed.description,
          createdBy: createdBy.id,
        },
        { sessionId: session.id, description: seed.description },
      );
    }

    for (const seed of EXPENSES) {
      const createdBy = usersByEmail.get(`${seed.createdBy}@barber.local`)!;

      const paidAt =
        seed.paidDaysAgo === undefined
          ? null
          : seed.paidDaysAgo === 0
            ? new Date()
            : slot(-seed.paidDaysAgo, 11, 0, config.shopTimezone);

      const expense = await upsertExpense(dataSource, {
        description: seed.description,
        category: seed.category,
        kind: seed.kind,
        amount: seed.amountCents,
        dueDate:
          seed.dueInDays === undefined ? null : shopDate(seed.dueInDays, config.shopTimezone),
        paidAt,
        paymentMethod: seed.paymentMethod ?? null,
        recurring: seed.recurring ?? false,
        createdBy: createdBy.id,
      });

      if (seed.paymentMethod !== 'cash') continue;

      await upsertMovement(
        dataSource,
        {
          sessionId: drawers.open.id,
          type: 'out',
          source: 'expense',
          amount: seed.amountCents,
          expenseId: expense.id,
          description: seed.description,
          createdBy: createdBy.id,
        },
        { expenseId: expense.id, type: 'out' },
      );
    }

    const rulesByScope = new Map<string, CommissionRule>();
    for (const seed of COMMISSION_RULES) {
      const barber = seed.barber ? barbersByKey.get(seed.barber)! : null;
      const service = seed.service ? servicesByName.get(seed.service)! : null;

      rulesByScope.set(
        ruleKey(seed.barber, seed.service, seed.appliesTo),
        await upsertCommissionRule(dataSource, seed, barber?.id ?? null, service?.id ?? null),
      );
    }

    for (const seed of COMMISSION_ENTRIES) {
      const { barber, day, hour, minute = 0 } = seed.appointment;
      const appointment = appointmentsByKey.get(appointmentKey(barber, day, hour, minute))!;

      if (appointment.status !== 'completed') continue;

      const rule = rulesByScope.get(ruleKey(seed.rule.barber, seed.rule.service))!;
      const baseAmount = await commissionBaseAmount(dataSource, appointment, rule.base);

      await upsertCommissionEntry(dataSource, appointment.id, {
        barberId: appointment.barberId,
        ruleId: rule.id,

        rate: rule.rate,
        base: rule.base,
        baseAmount,
        amount: Math.round(baseAmount * rule.rate),

        createdAt: appointment.endsAt,
      });
    }

    for (const seed of COMMISSION_ADVANCES) {
      const barber = barbersByKey.get(seed.barber)!;
      const createdBy = usersByEmail.get(`${seed.createdBy}@barber.local`)!;

      const advance = await upsertCommissionAdvance(dataSource, {
        barberId: barber.id,
        amount: seed.amountCents,
        notes: seed.notes,
        createdBy: createdBy.id,
        createdAt: slot(-seed.daysAgo, 12, 0, config.shopTimezone),
      });

      if (seed.paymentMethod !== 'cash') continue;

      await upsertMovement(
        dataSource,
        {
          sessionId: drawers[seed.drawer ?? 'open'].id,
          type: 'out',
          source: 'advance',
          amount: advance.amount,
          advanceId: advance.id,
          description: seed.notes,
          createdBy: createdBy.id,
        },
        { advanceId: advance.id },
      );
    }

    for (const seed of COMMISSION_PERIODS) {
      const barber = barbersByKey.get(seed.barber)!;
      const closedBy = usersByEmail.get(`${seed.closedBy}@barber.local`)!;

      const period = await closeSeedPeriod(
        dataSource,
        seed,
        barber.id,
        closedBy.id,
        config.shopTimezone,
      );

      if (!period || !seed.paidWith || period.status === 'paid') continue;

      await dataSource.getRepository(CommissionPeriod).save({
        id: period.id,
        status: 'paid',
        paidAt: slot(-seed.endsDaysAgo + 2, 10, 0, config.shopTimezone),
        paymentMethod: seed.paidWith.paymentMethod,
      });

      if (seed.paidWith.paymentMethod !== 'cash' || period.totalDue <= 0) continue;

      await upsertMovement(
        dataSource,
        {
          sessionId: drawers[seed.paidWith.drawer ?? 'open'].id,
          type: 'out',
          source: 'payout',
          amount: period.totalDue,
          periodId: period.id,
          description: `Comissão ${period.startsOn}..${period.endsOn} — ${barber.displayName}`,
          createdBy: closedBy.id,
        },
        { periodId: period.id },
      );
    }

    const productsByName = new Map<string, Product>();
    for (const seed of PRODUCTS) {
      const product = await upsertProduct(dataSource, seed);
      productsByName.set(seed.name, product);

      for (const adjustment of seed.adjustments) {
        const createdBy = usersByEmail.get(`${adjustment.createdBy}@barber.local`)!;

        await upsertStockAdjustment(
          dataSource,
          adjustment,
          product.id,
          createdBy.id,
          config.shopTimezone,
        );
      }
    }

    for (const seed of PRODUCT_SALES) {
      const createdBy = usersByEmail.get(`${seed.createdBy}@barber.local`)!;
      const barber = seed.soldBy ? barbersByKey.get(seed.soldBy)! : null;
      const client = seed.client ? usersByEmail.get(`${seed.client}@barber.local`)! : null;

      await seedProductSale(dataSource, seed, {
        products: productsByName,
        barberId: barber?.id ?? null,
        clientId: client?.id ?? null,
        createdBy: createdBy.id,
        sessionId: seed.method === 'cash' ? drawers[seed.drawer ?? 'open'].id : null,
        cardFeeRates: config.cardFeeRates,
        rule: rulesByScope.get(ruleKey(null, null, 'products')) ?? null,

        createdAt: slot(0, 15, 0, config.shopTimezone),
      });
    }

    await snapshotClosedSession(dataSource, drawers.closed);

    const [
      users,
      barbers,
      schedules,
      blocks,
      services,
      appointments,
      clientProfiles,
      payments,
      sessions,
      movements,
      expenses,
      commissionRules,
      commissionEntries,
      commissionAdvances,
      commissionPeriods,
      products,
      stockAdjustments,
      productSales,
    ] = await Promise.all([
      dataSource.getRepository(User).count(),
      dataSource.getRepository(Barber).count(),
      dataSource.getRepository(BarberSchedule).count(),
      dataSource.getRepository(BarberBlock).count(),
      dataSource.getRepository(Service).count(),
      dataSource.getRepository(Appointment).count(),
      dataSource.getRepository(ClientProfile).count(),
      dataSource.getRepository(Payment).count(),
      dataSource.getRepository(CashRegisterSession).count(),
      dataSource.getRepository(CashMovement).count(),
      dataSource.getRepository(Expense).count(),
      dataSource.getRepository(CommissionRule).count(),
      dataSource.getRepository(CommissionEntry).count(),
      dataSource.getRepository(CommissionAdvance).count(),
      dataSource.getRepository(CommissionPeriod).count(),
      dataSource.getRepository(Product).count(),
      dataSource.getRepository(StockAdjustment).count(),
      dataSource.getRepository(ProductSale).count(),
    ]);

    logger.info(
      {
        users,
        barbers,
        schedules,
        blocks,
        services,
        appointments,
        clientProfiles,
        payments,
        sessions,
        movements,
        expenses,
        commissionRules,
        commissionEntries,
        commissionAdvances,
        commissionPeriods,
        products,
        stockAdjustments,
        productSales,
        timezone: config.shopTimezone,
        logins: {
          admin: 'admin@barber.local',
          manager: 'marcos@barber.local',
          barber: 'rafael@barber.local',
          client: 'cliente@barber.local',
        },
        cannotLogIn: {
          deactivated: 'lucia@barber.local',
          walkIn: 'walkin@barber.local (no password)',
        },
      },

      `seed complete — every account that can log in uses the password ${SEED_PASSWORD}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
