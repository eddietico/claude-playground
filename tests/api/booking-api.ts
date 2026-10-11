import { type APIRequestContext } from '@playwright/test';

export type Booking = {
  firstname: string;
  lastname: string;
  totalprice: number;
  depositpaid: boolean;
  bookingdates: { checkin: string; checkout: string };
  additionalneeds?: string;
};

/**
 * Client for the Restful Booker API (https://restful-booker.herokuapp.com),
 * the API counterpart of the TodoPage page object. Methods return the raw
 * APIResponse so tests can assert on status codes as well as bodies.
 */
export class BookingApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token?: string,
  ) {}

  /** Writes need the token as a cookie; without one they're rejected. */
  private get auth(): Record<string, string> {
    return this.token ? { Cookie: `token=${this.token}` } : {};
  }

  /** Returns the token, or undefined if the credentials are rejected. */
  static async login(request: APIRequestContext, username: string, password: string) {
    const response = await request.post('/auth', { data: { username, password } });
    const body = (await response.json()) as { token?: string };
    return body.token;
  }

  create(booking: Booking) {
    return this.request.post('/booking', { data: booking });
  }

  get(id: number) {
    return this.request.get(`/booking/${id}`);
  }

  findByName(firstname: string, lastname: string) {
    return this.request.get('/booking', { params: { firstname, lastname } });
  }

  update(id: number, booking: Booking) {
    return this.request.put(`/booking/${id}`, { data: booking, headers: this.auth });
  }

  patch(id: number, changes: Partial<Booking>) {
    return this.request.patch(`/booking/${id}`, { data: changes, headers: this.auth });
  }

  delete(id: number) {
    return this.request.delete(`/booking/${id}`, { headers: this.auth });
  }
}
