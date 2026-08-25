import {
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { moneyTransformer } from '../lib/money';
import { Barber } from './barber.entity';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './enums';
import { Service } from './service.entity';
import { User } from './user.entity';

@Entity('appointments')
@Index('idx_appointments_barber_starts_at', ['barberId', 'startsAt'])
@Index('idx_appointments_client_starts_at', ['clientId', 'startsAt'])

@Exclusion(
  'appointments_no_overlap',
  `USING gist (barber_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status IN ('scheduled', 'confirmed'))`,
)
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  clientId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client?: User;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'uuid' })
  serviceId!: string;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_id' })
  service?: Service;

  @Column({
    type: 'enum',
    enum: APPOINTMENT_STATUSES,
    enumName: 'appointment_status',
    default: 'scheduled',
  })
  status!: AppointmentStatus;

  @Column({ type: 'timestamptz' })
  startsAt!: Date;

  @Column({ type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: moneyTransformer })
  price!: number;

  @Column({ type: 'smallint' })
  durationMinutes!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', nullable: true })
  cancelledReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledBy!: string | null;

  @Column({ type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
