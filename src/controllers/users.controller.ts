import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import { requireUser } from '../middleware/authenticate';
import type {
  CreateStaffBody,
  ListUsersQuery,
  UpdateSelfBody,
  UpdateUserBody,
  UserIdParams,
} from '../schemas/users.schemas';
import type { UsersService } from '../services/users.service';

export class UsersController {
  private readonly usersService: UsersService;

  constructor({ usersService }: Cradle) {
    this.usersService = usersService;
  }

  getMe = async (req: Request, res: Response): Promise<void> => {
    res.json({ data: await this.usersService.getById(requireUser(req).id) });
  };

  updateMe = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as UpdateSelfBody;

    res.json({ data: await this.usersService.updateSelf(requireUser(req).id, body) });
  };

  createStaff = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as CreateStaffBody;

    res.status(201).json({ data: await this.usersService.createStaff(body) });
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const query = req.validated.query as ListUsersQuery;

    res.json({ data: await this.usersService.list(query) });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.validated.params as UserIdParams;
    const body = req.validated.body as UpdateUserBody;

    res.json({ data: await this.usersService.updateUser(id, body) });
  };
}
