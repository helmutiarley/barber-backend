import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  CreateExpenseBody,
  ExpenseIdParams,
  ListExpensesQuery,
  PayExpenseBody,
  UpdateExpenseBody,
} from '../schemas/expenses.schemas';
import type { ExpensesService, PagedExpenses } from '../services/expenses.service';

function paged(result: PagedExpenses) {
  return {
    data: result.items,
    meta: { total: result.total, limit: result.limit, offset: result.offset },
  };
}

export class ExpensesController {
  private readonly expensesService: ExpensesService;

  constructor({ expensesService }: Cradle) {
    this.expensesService = expensesService;
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateExpenseBody;

    res.status(201).json({ data: await this.expensesService.create(body, requireUser(req)) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListExpensesQuery;

    res.json(paged(await this.expensesService.list(query)));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ExpenseIdParams;

    res.json({ data: await this.expensesService.get(id) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ExpenseIdParams;
    const body = req.validated.body as UpdateExpenseBody;

    res.json({ data: await this.expensesService.update(id, body) });
  };

  pay = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ExpenseIdParams;
    const body = req.validated.body as PayExpenseBody;

    res.json({ data: await this.expensesService.pay(id, body, requireUser(req)) });
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as ExpenseIdParams;

    await this.expensesService.remove(id);

    res.status(204).send();
  };
}
