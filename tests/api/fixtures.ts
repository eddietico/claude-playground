import { test as base, expect } from '@playwright/test';
import { BookingApi, type Booking } from './booking-api';

type Fixtures = {
  /** A token for the API's demo admin account. */
  token: string;
  /** A client that sends the token with every write. */
  api: BookingApi;
  /** Booking data with a unique last name, so tests can't see each other's data. */
  bookingData: Booking;
  /** A booking created for the test and deleted afterwards. */
  booking: { id: number; data: Booking };
};

/**
 * Unlike the TodoMVC demo, whose data lives in each browser context and
 * vanishes after the test, this server is shared and keeps everything. So
 * tests create their own data with unique names and delete it afterwards.
 */
export const test = base.extend<Fixtures>({
  token: async ({ request }, use) => {
    // The API's public demo credentials, documented on its home page.
    const token = await BookingApi.login(request, 'admin', 'password123');
    expect(token, 'login with the demo credentials').toBeTruthy();
    await use(token!);
  },

  api: async ({ request, token }, use) => {
    await use(new BookingApi(request, token));
  },

  // Playwright requires the first argument to be a destructuring pattern,
  // even with no dependencies.
  // oxlint-disable-next-line eslint/no-empty-pattern
  bookingData: async ({}, use) => {
    await use({
      firstname: 'Playwright',
      lastname: `test-${crypto.randomUUID().slice(0, 8)}`,
      totalprice: 150,
      depositpaid: true,
      bookingdates: { checkin: '2026-11-01', checkout: '2026-11-03' },
      additionalneeds: 'Breakfast',
    });
  },

  booking: async ({ api, bookingData }, use) => {
    const response = await api.create(bookingData);
    expect(response.ok(), 'create the booking for the test').toBe(true);
    const { bookingid } = (await response.json()) as { bookingid: number };

    await use({ id: bookingid, data: bookingData });

    // Teardown. A test may have deleted it already, so don't check the status.
    await api.delete(bookingid);
  },
});

export { expect } from '@playwright/test';
