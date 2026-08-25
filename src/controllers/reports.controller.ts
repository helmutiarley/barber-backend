import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  BarberIdParams,
  RangeQuery,
  RevenueQuery,
  TopServicesQuery,
} from '../schemas/reports.schemas';
import type { ReportsService } from '../services/reports.service';

export class ReportsController {
  private readonly reportsService: ReportsService;

  constructor({ reportsService }: Cradle) {
    this.reportsService = reportsService;
  }

  revenue = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RevenueQuery;

    res.json({ data: await this.reportsService.revenue(query) });
  };

  averageTicket = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.averageTicket(query) });
  };

  topServices = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as TopServicesQuery;

    res.json({ data: await this.reportsService.topServices(query) });
  };

  products = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.products(query) });
  };

  dre = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.dre(query) });
  };

  occupancy = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.occupancy(query) });
  };

  noShows = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.noShows(query) });
  };

  clients = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as RangeQuery;

    res.json({ data: await this.reportsService.clients(query) });
  };

  barberSummary = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as BarberIdParams;
    const query = req.validated.query as RangeQuery;

    res.json({
      data: await this.reportsService.barberSummary(id, query, requireUser(req)),
    });
  };
}
