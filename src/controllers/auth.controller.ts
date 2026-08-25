import type { Request, Response } from 'express';
import type { Cradle } from '../container';
import type { LoginBody, RefreshBody, RegisterBody } from '../schemas/auth.schemas';
import type { AuthService } from '../services/auth.service';

export class AuthController {
  private readonly authService: AuthService;

  constructor({ authService }: Cradle) {
    this.authService = authService;
  }

  register = async (req: Request, res: Response): Promise<void> => {
    const body = req.validated.body as RegisterBody;

    res.status(201).json({ data: await this.authService.register(body) });
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.validated.body as LoginBody;

    res.json({ data: await this.authService.login(email, password) });
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.validated.body as RefreshBody;

    res.json({ data: await this.authService.refresh(refreshToken) });
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.validated.body as RefreshBody;
    await this.authService.logout(refreshToken);

    res.status(204).send();
  };
}
