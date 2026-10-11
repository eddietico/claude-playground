import { BookingApi } from './booking-api';
import { test, expect } from './fixtures';

test('creates a booking and reads it back', async ({ api, bookingData }) => {
  const created = await api.create(bookingData);
  expect(created.ok()).toBe(true);
  const body = (await created.json()) as { bookingid: number };
  // The response contract: a numeric id plus the booking exactly as sent.
  expect(body).toEqual({ bookingid: expect.any(Number), booking: bookingData });

  try {
    const fetched = await api.get(body.bookingid);
    expect(fetched.status()).toBe(200);
    expect(await fetched.json()).toEqual(bookingData);
  } finally {
    // Not created by the booking fixture, so clean it up here.
    await api.delete(body.bookingid);
  }
});

test('finds a booking by name', async ({ api, booking }) => {
  const response = await api.findByName(booking.data.firstname, booking.data.lastname);

  expect(response.status()).toBe(200);
  // The last name is unique to this test, so exactly one result.
  expect(await response.json()).toEqual([{ bookingid: booking.id }]);
});

test('replaces a booking with PUT', async ({ api, booking }) => {
  const changed = { ...booking.data, totalprice: 300, depositpaid: false };

  const response = await api.update(booking.id, changed);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(changed);
  expect(await (await api.get(booking.id)).json()).toEqual(changed);
});

test('changes only the given fields with PATCH', async ({ api, booking }) => {
  const response = await api.patch(booking.id, { totalprice: 200 });

  expect(response.status()).toBe(200);
  expect(await (await api.get(booking.id)).json()).toEqual({ ...booking.data, totalprice: 200 });
});

test('deletes a booking', async ({ api, booking }) => {
  const response = await api.delete(booking.id);

  expect(response.ok()).toBe(true);
  expect((await api.get(booking.id)).status()).toBe(404);
});

test('rejects writes without a token', async ({ request, booking }) => {
  const anonymous = new BookingApi(request);

  expect((await anonymous.patch(booking.id, { totalprice: 1 })).status()).toBe(403);
  expect((await anonymous.delete(booking.id)).status()).toBe(403);
  // And nothing changed.
  expect(await (await anonymous.get(booking.id)).json()).toEqual(booking.data);
});

test('returns 404 for a booking that does not exist', async ({ api }) => {
  expect((await api.get(999_999_999)).status()).toBe(404);
});

// Known bugs: the API returns the wrong status codes, apparently on purpose
// (it's a practice API). test.fail() keeps the suite green while they exist.
// Each was run once without test.fail() to check it fails on the status.
test.describe('known bugs', () => {
  test('creating returns 201 Created', async ({ api, bookingData }) => {
    test.fail(true, 'Returns 200');
    const response = await api.create(bookingData);
    const { bookingid } = (await response.json()) as { bookingid: number };
    await api.delete(bookingid);

    expect(response.status()).toBe(201);
  });

  test('deleting returns 200 or 204', async ({ api, booking }) => {
    test.fail(true, 'Returns 201 Created');
    const response = await api.delete(booking.id);

    expect([200, 204], `status ${response.status()} should be 200 or 204`).toContain(
      response.status(),
    );
  });

  test('wrong credentials return 401', async ({ request }) => {
    test.fail(true, 'Returns 200 with {"reason": "Bad credentials"}');
    const response = await request.post('/auth', { data: { username: 'admin', password: 'wrong' } });

    expect(response.status()).toBe(401);
  });

  test('an incomplete booking returns 400', async ({ api }) => {
    test.fail(true, 'Returns 500 Internal Server Error');
    // Cast: deliberately sending a booking with required fields missing.
    const response = await api.create({ firstname: 'Playwright' } as never);

    expect(response.status()).toBe(400);
  });
});
