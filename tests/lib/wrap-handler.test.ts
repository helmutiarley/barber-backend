import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { wrapHandler } from '../../src/lib/wrap-handler';

function fakeRequest(registrations: Record<string, unknown>): Request {
  return {
    container: {
      resolve(name: string) {
        if (!(name in registrations)) {
          throw new Error(`Could not resolve '${name}'`);
        }
        return registrations[name];
      },
    },
  } as unknown as Request;
}

describe('wrapHandler', () => {
  it('resolves the controller from the request scope and invokes the method', async () => {
    const controller = {
      greet: vi.fn(async (_req: Request, res: Response) => {
        res.json({ data: 'hi' });
      }),
    };
    const req = fakeRequest({ fakeController: controller });
    const res = { json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    await wrapHandler('fakeController.greet')(req, res, next);

    expect(controller.greet).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith({ data: 'hi' });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards async controller errors to next', async () => {
    const boom = new Error('boom');
    const controller = { explode: vi.fn(async () => Promise.reject(boom)) };
    const req = fakeRequest({ fakeController: controller });
    const next = vi.fn();

    await wrapHandler('fakeController.explode')(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(boom);
  });

  it('errors through next when the controller is not registered', async () => {
    const req = fakeRequest({});
    const next = vi.fn();

    await wrapHandler('missingController.method')(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0][0] as Error).message).toMatch(/missingController/);
  });

  it('errors through next when the method does not exist', async () => {
    const req = fakeRequest({ fakeController: {} });
    const next = vi.fn();

    await wrapHandler('fakeController.nope')(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((next.mock.calls[0][0] as Error).message).toBe('Handler fakeController.nope not found');
  });
});
