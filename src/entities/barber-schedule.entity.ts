import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Barber } from './barber.entity';

export type TimeOfDay = string;

@Entity('barber_schedules')
@Index('uq_barber_schedules_barber_weekday', ['barberId', 'weekday'], { unique: true })

@Check('chk_barber_schedules_weekday', '"weekday" BETWEEN 0 AND 6')
@Check('chk_barber_schedules_window', '"end_time" > "start_time"')
@Check(
  'chk_barber_schedules_break',
  `("break_start" IS NULL AND "break_end" IS NULL)
   OR ("break_start" IS NOT NULL AND "break_end" IS NOT NULL
       AND "break_end" > "break_start"
       AND "break_start" >= "start_time"
       AND "break_end" <= "end_time")`,
)
export class BarberSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_barber_schedules_shop_id')
  @Column({ type: 'uuid' })
  shopId!: string;

  @Column({ type: 'uuid' })
  barberId!: string;

  @ManyToOne(() => Barber, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'barber_id' })
  barber?: Barber;

  @Column({ type: 'smallint' })
  weekday!: number;

  @Column({ type: 'time' })
  startTime!: TimeOfDay;

  @Column({ type: 'time' })
  endTime!: TimeOfDay;

  @Column({ type: 'time', nullable: true })
  breakStart!: TimeOfDay | null;

  @Column({ type: 'time', nullable: true })
  breakEnd!: TimeOfDay | null;
}
