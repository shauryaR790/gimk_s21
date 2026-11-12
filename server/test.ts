import assert from 'node:assert/strict';
import { applyLineQuantity, buildSalesReport, canTransition, cartLineKey, clampLineQuantity, dueTotal, formatZonedYmd, maskMobile, nextTicketStatus, noteValue, orderChannel, orderFlag, priceCart, registerPath, resolveMenuShortcut, shiftYmd, splitAmounts, tableVisualState, zonedDayStart, type AddonGroup, type MenuItem } from '../shared/domain';
import { fillTemplate } from '../shared/comms';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_DEV_EXPOSE = 'false';
process.env.SESSION_SECRET = 'test-secret';
process.env.ADMIN_EMAIL = 'admin@habs.cafe';
process.env.ADMIN_PASSWORD = 'habsos-admin';

const drinks: MenuItem[] = [
  { id: 'item_cappuccino', categoryId: 'cat_drinks', name: 'Cappuccino', description: '', price: 160, imageUrl: null, isVeg: true, isAvailable: true, isFavorite: true, shortcutNum: '4', shortcutAlpha: 'CAP', sortOrder: 3, addonGroupIds: ['group_size', 'group_milk', 'group_extras'], menuLead: '', menuSubtitle: '', kcalLabel: '', ingredients: [] },
  { id: 'item_choc_muffin', categoryId: 'cat_food', name: 'Chocolate Muffin', description: '', price: 130, imageUrl: null, isVeg: true, isAvailable: true, isFavorite: false, shortcutNum: '72', shortcutAlpha: 'GS', sortOrder: 14, addonGroupIds: [], menuLead: '', menuSubtitle: '', kcalLabel: '', ingredients: [] },
];

const groups: AddonGroup[] = [
  { id: 'group_size', name: 'Size', minSelect: 0, maxSelect: 1, sortOrder: 1, addons: [{ id: 'addon_large', groupId: 'group_size', name: 'Large', price: 40, isAvailable: true, sortOrder: 1 }] },
  { id: 'group_milk', name: 'Milk', minSelect: 0, maxSelect: 1, sortOrder: 2, addons: [{ id: 'addon_oat', groupId: 'group_milk', name: 'Oat Milk', price: 30, isAvailable: true, sortOrder: 1 }, { id: 'addon_almond', groupId: 'group_milk', name: 'Almond Milk', price: 40, isAvailable: true, sortOrder: 2 }] },
  { id: 'group_extras', name: 'Extras', minSelect: 0, maxSelect: 3, sortOrder: 3, addons: [{ id: 'addon_extra_shot', groupId: 'group_extras', name: 'Extra Shot', price: 50, isAvailable: true, sortOrder: 1 }] },
];

const quote = priceCart({
  taxBps: 500,
  items: drinks,
  groups,
  lines: [
    { menuItemId: 'item_cappuccino', quantity: 1, addonIds: ['addon_large', 'addon_oat', 'addon_extra_shot'] },
    { menuItemId: 'item_choc_muffin', quantity: 1, addonIds: [] },
  ],
});
assert.equal(quote.lines[0].total, 280);
assert.equal(quote.subtotal, 410);
assert.equal(quote.tax, 21);
assert.equal(quote.total, 431);
assert.equal(canTransition('CONFIRMED', 'PREPARING'), false);
assert.equal(canTransition('CONFIRMED', 'READY'), true);
assert.equal(canTransition('CONFIRMED', 'SERVED'), true);
assert.equal(nextTicketStatus('CONFIRMED', 'kot'), 'READY');
assert.equal(nextTicketStatus('CONFIRMED', 'print'), 'SERVED');
assert.equal(nextTicketStatus('READY', 'kot'), null);
assert.equal(nextTicketStatus('SERVED', 'print'), null);
assert.equal(orderFlag('HOLD\nCOVER:2', 'HOLD'), true);
assert.equal(orderFlag('COVER:2', 'HOLD'), false);
assert.equal(maskMobile('9876500123'), 'XXXXXXX123');
assert.equal(resolveMenuShortcut(drinks, '4')?.id, 'item_cappuccino');
assert.equal(resolveMenuShortcut(drinks, 'cap')?.id, 'item_cappuccino');
assert.equal(resolveMenuShortcut(drinks, '72')?.id, 'item_choc_muffin');
assert.equal(resolveMenuShortcut(drinks, 'GS')?.id, 'item_choc_muffin');
assert.equal(resolveMenuShortcut(drinks, 'nope'), undefined);
assert.equal(clampLineQuantity(0), 1);
assert.equal(clampLineQuantity(21), 20);
assert.equal(applyLineQuantity(18, 5).quantity, 20);
assert.equal(applyLineQuantity(18, 5).capped, true);
assert.equal(registerPath({ tableId: 'table_t01', orderId: 'abc', mode: 'dine' }), '/pos/app/register?mode=dine&table=table_t01&order=abc');
assert.equal(noteValue('CAPTAIN:Riya\nCOVER:2', 'CAPTAIN'), 'Riya');
assert.deepEqual(splitAmounts(100, 3), [34, 33, 33]);
assert.deepEqual(splitAmounts(101, 2), [51, 50]);
assert.throws(() => splitAmounts(10, 1), /2–8/);
assert.equal(
  cartLineKey({ menuItemId: 'item_cappuccino', addonIds: ['addon_oat', 'addon_large'], notes: '  less ice ' }),
  cartLineKey({ menuItemId: 'item_cappuccino', addonIds: ['addon_large', 'addon_oat'], notes: 'less ice' }),
);
assert.throws(() => priceCart({
  taxBps: 500,
  items: drinks,
  groups,
  lines: [{ menuItemId: 'item_choc_muffin', quantity: 21, addonIds: [] }],
}), /Quantity must be between 1 and 20/);
assert.equal(orderChannel({ tableId: 'table_t01', notes: '' }), 'dine');
assert.equal(orderChannel({ tableId: null, notes: 'MODE:DELIVERY' }), 'delivery');
assert.equal(orderChannel({ tableId: null, notes: 'MODE:PICKUP' }), 'pickup');
assert.equal(shiftYmd('2026-10-06', -1), '2026-10-05');
assert.equal(shiftYmd('2026-01-01', -1), '2025-12-31');
assert.equal(zonedDayStart('Asia/Kolkata', '2026-10-06').toISOString(), '2026-10-05T18:30:00.000Z');
assert.equal(
  buildSalesReport({
    orders: [{
      id: 'o1',
      orderNumber: 9,
      cafeId: 'c',
      tableId: null,
      tableName: null,
      customerId: null,
      customerName: 'Walk-in',
      customerMobile: '',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: 150,
      tax: 8,
      discount: 0,
      total: 158,
      source: 'POS',
      notes: 'MODE:PICKUP',
      createdAt: '2026-10-06T05:30:00.000Z',
      updatedAt: '2026-10-06T05:30:00.000Z',
      syncedAt: null,
      items: [{ id: 'i1', menuItemId: 'item_espresso', nameSnapshot: 'Classic Espresso', quantity: 1, unitPrice: 150, total: 150, notes: '', addons: [] }],
      events: [],
      payments: [{ id: 'p1', method: 'CASH', amount: 158, status: 'PAID', createdAt: '2026-10-06T05:31:00.000Z' }],
    }],
    categoryName: () => 'Drinks',
    timeZone: 'Asia/Kolkata',
    from: '2026-10-05T18:30:00.000Z',
    to: '2026-10-06T18:30:00.000Z',
    fromYmd: '2026-10-06',
    toYmd: '2026-10-06',
  }).byChannel.pickup.amount,
  158,
);

const logic = await import('./logic');
const seed = await import('./seed');
const otp = await import('./otp');
await seed.seed();

const fresh = logic.getOrderByNumber(104);
assert.ok(fresh);
assert.equal(fresh.status, 'CONFIRMED');
assert.equal(fresh.paymentStatus, 'UNPAID');
assert.equal(fresh.tableName, 'T05');
assert.equal(fresh.customerName, 'Arjun');
assert.equal(fresh.items[0].nameSnapshot, 'Espresso');
assert.equal(fresh.events[0].message, 'Order placed');

logic.updateMenuItem('item_espresso', { name: 'New Espresso', price: 220, description: 'Changed', isAvailable: true });
const historical = logic.getOrderByNumber(104);
assert.equal(historical?.items[0].nameSnapshot, 'Espresso');
assert.equal(historical?.items[0].unitPrice, fresh.items[0].unitPrice);
logic.updateMenuItem('item_espresso', { name: 'Espresso', description: 'A short, intense shot of coffee.', price: 150, isAvailable: true });

assert.throws(() => logic.transitionOrder(fresh.id, 'PREPARING'), /Cannot move/);
const printed = logic.createStaffOrder({
  tableCode: 'T09',
  customerName: 'Print skip',
  customerMobile: '',
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
});
assert.equal(printed.status, 'CONFIRMED');
assert.equal(logic.transitionOrder(printed.id, 'SERVED').status, 'SERVED');
const running = logic.createStaffOrder({
  tableCode: 'T08',
  customerName: 'Add on',
  customerMobile: '',
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
});
assert.equal(running.items.length, 1);
const added = logic.replaceStaffOrderItems(running.id, {
  customerName: 'Add on',
  items: [
    { menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] },
    { menuItemId: 'item_bacon_burger', quantity: 1, addonIds: [] },
  ],
});
assert.equal(added.items.length, 2);
assert.ok(added.total > running.total);
assert.throws(() => logic.replaceStaffOrderItems(logic.getOrderByNumber(101)!.id, {
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
}), /no longer be edited/);
const readyNow = logic.transitionOrder(fresh.id, 'READY');
assert.equal(readyNow.status, 'READY');
assert.equal(readyNow.events.at(-1)?.message, 'Ready');

assert.throws(() => {
  logic.createStaffOrder({
    tableCode: 'T04',
    customerName: 'Test',
    customerMobile: '9876500999',
    items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: ['addon_oat'] }],
  });
}, /not available/);

logic.updateMenuItem('item_espresso', { name: 'Espresso', description: 'A short, intense shot of coffee.', price: 150, isAvailable: false });
assert.throws(() => {
  logic.createStaffOrder({
    tableCode: 'T04',
    customerName: 'Test',
    customerMobile: '9876500998',
    items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
  });
}, /sold out/);
logic.updateMenuItem('item_espresso', { name: 'Espresso', description: 'A short, intense shot of coffee.', price: 150, isAvailable: true });

const clientKey = crypto.randomUUID();
const pending = await logic.startCheckout({
  tableCode: 'T06',
  customerName: 'Neel',
  customerMobile: '+91 98765 43210',
  clientKey,
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: ['addon_tall'], notes: 'less ice' }],
});
assert.equal(pending.order.status, 'OTP_PENDING');
assert.equal(pending.order.customerMobile, '9876543210');
const americano = 150 + 40;
assert.equal(pending.order.subtotal, americano);
assert.equal(pending.order.tax, Math.round((americano * 500) / 10000));
assert.equal(pending.order.total, americano + Math.round((americano * 500) / 10000));
const code = otp.peekDevCode(pending.challengeId!);
assert.ok(code);
await assert.rejects(logic.verifyCheckout(pending.order.id, '000000'), /not correct/);
const confirmed = await logic.verifyCheckout(pending.order.id, code!);
assert.equal(confirmed.status, 'CONFIRMED');
assert.equal(confirmed.paymentStatus, 'UNPAID');
assert.equal(confirmed.tableName, 'T06');
const paid = logic.markPaid(confirmed.id, 'UPI');
assert.equal(paid.paymentStatus, 'PAID');
assert.equal(paid.status, 'COMPLETED');
assert.equal(paid.payments[0].method, 'UPI');
assert.equal(paid.payments[0].amount, confirmed.total);

const again = logic.createStaffOrder({
  id: confirmed.id,
  tableCode: 'T06',
  customerName: 'Neel',
  customerMobile: '9876543210',
  items: [{ menuItemId: 'item_espresso', quantity: 9, addonIds: [] }],
  clientKey: confirmed.id,
});
assert.equal(again.total, confirmed.total);

const synced = logic.applySyncBatch([
  {
    id: 'q1',
    operation: 'CREATE_ORDER',
    entityId: crypto.randomUUID(),
    payload: {
      id: crypto.randomUUID(),
      tableCode: 'T07',
      customerName: 'Walk in',
      customerMobile: '',
      items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
    },
  },
]);
assert.equal(synced[0].ok, true);
assert.equal(synced[0].order?.total, 158);
assert.equal(synced[0].order?.source, 'POS');

const catalog = logic.loadCatalog();
const pizza = catalog.items.find((item) => item.id === 'item_pizza_veg');
assert.equal(pizza?.shortcutNum, '4');
assert.equal(pizza?.shortcutAlpha, 'PV');
assert.equal(pizza?.isFavorite, true);
assert.equal(resolveMenuShortcut(catalog.items, '4')?.id, 'item_pizza_veg');
assert.equal(resolveMenuShortcut(catalog.items, 'PM')?.id, 'item_pizza_margherita');
assert.equal(catalog.items.filter((item) => item.isFavorite).length, 26);
assert.throws(() => logic.updateMenuItem('item_espresso', { shortcutNum: '4' }), /already used/);

const partBill = logic.createStaffOrder({
  tableCode: 'T11',
  customerName: 'Part',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 2, addonIds: [] }],
});
const partPaid = logic.markPaid(partBill.id, 'CASH', 50);
assert.equal(partPaid.paymentStatus, 'UNPAID');
assert.equal(dueTotal(partPaid), partBill.total - 50);
assert.equal(partPaid.payments[0].amount, 50);
assert.throws(() => logic.splitStaffOrder(partBill.id, 2), /part payment/);
const closedPart = logic.markPaid(partBill.id, 'CARD');
assert.equal(closedPart.paymentStatus, 'PAID');
assert.equal(closedPart.status, 'COMPLETED');
assert.equal(closedPart.payments.reduce((sum, payment) => sum + payment.amount, 0), partBill.total);

const splitSrc = logic.createStaffOrder({
  tableCode: 'T12',
  customerName: 'Split',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 2, addonIds: [] }],
});
const kids = logic.splitStaffOrder(splitSrc.id, 2);
assert.equal(kids.length, 2);
assert.equal(kids[0].total + kids[1].total, splitSrc.total);
assert.equal(kids[0].subtotal + kids[1].subtotal, splitSrc.subtotal);
assert.equal(logic.getOrder(splitSrc.id)?.status, 'CANCELLED');
assert.match(kids[0].notes, /SPLIT:1\/2/);
assert.match(kids[1].notes, /PARENT:/);
const tableNine = logic.listTables().find((table) => table.name === 'T12');
assert.equal(tableNine?.status, 'OCCUPIED');
assert.equal(tableNine?.openOrder?.due, splitSrc.total);
assert.equal(tableNine?.openOrder?.total, splitSrc.total);
assert.throws(() => logic.createStaffOrder({
  tableCode: 'T12',
  customerName: 'Blocked',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
}), /already has an open order/);
const extra = logic.createStaffOrder({
  tableCode: 'T12',
  customerName: 'Extra',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
  allowOpenTable: true,
});
assert.equal(extra.tableName, 'T12');
const paidChild = logic.markPaid(kids[0].id, 'UPI');
assert.equal(paidChild.paymentStatus, 'PAID');
const stillOpen = logic.listTables().find((table) => table.name === 'T12');
assert.equal(stillOpen?.status, 'OCCUPIED');
assert.ok((stillOpen?.openOrder?.due ?? 0) > 0);

const dueSync = logic.createStaffOrder({
  tableCode: 'T13',
  customerName: 'Due',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
  notes: 'DUE',
});
const syncedPart = logic.applySyncBatch([
  {
    id: 'q-part',
    operation: 'MARK_PAID',
    entityId: dueSync.id,
    payload: { method: 'CASH', amount: 40 },
  },
]);
assert.equal(syncedPart[0].ok, true);
assert.equal(syncedPart[0].order?.paymentStatus, 'UNPAID');
assert.equal(dueTotal(syncedPart[0].order!), dueSync.total - 40);

const settled = logic.createStaffOrder({
  tableCode: 'T14',
  customerName: 'Paid table',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
logic.markPaid(settled.id, 'CASH');
const paidTable = logic.listTables().find((table) => table.name === 'T14');
assert.equal(paidTable?.status, 'OCCUPIED');
assert.equal(paidTable?.openOrder?.paymentStatus, 'PAID');
assert.equal(paidTable?.openOrder?.due, 0);
logic.setTableStage(paidTable!.id, 'blank');
const clearedPaidTable = logic.listTables().find((table) => table.name === 'T14');
assert.equal(clearedPaidTable?.openOrder, null);
assert.equal(clearedPaidTable?.status, 'AVAILABLE');
assert.equal(tableVisualState(clearedPaidTable!), 'blank');
const reuse = logic.createStaffOrder({
  tableCode: 'T14',
  customerName: 'Next guest',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
assert.equal(reuse.tableName, 'T14');
assert.equal(reuse.paymentStatus, 'UNPAID');
const reused = logic.listTables().find((table) => table.name === 'T14');
assert.equal(reused?.openOrder?.id, reuse.id);
assert.equal(reused?.openOrder?.paymentStatus, 'UNPAID');
logic.transitionOrder(reuse.id, 'READY');
assert.equal(logic.listTables().find((table) => table.name === 'T14')?.openOrder?.status, 'READY');
logic.transitionOrder(reuse.id, 'SERVED');
assert.equal(logic.listTables().find((table) => table.name === 'T14')?.openOrder?.status, 'SERVED');

const todayYmd = formatZonedYmd('Asia/Kolkata');
const beforeReport = logic.reportRange(todayYmd, todayYmd);
const pickupSale = logic.createStaffOrder({
  customerName: 'Report pickup',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
  notes: 'MODE:PICKUP',
});
logic.markPaid(pickupSale.id, 'CASH');
const deliverySale = logic.createStaffOrder({
  customerName: 'Report delivery',
  customerMobile: '',
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
  notes: 'MODE:DELIVERY',
});
logic.markPaid(deliverySale.id, 'UPI');
const ncSale = logic.createStaffOrder({
  tableCode: 'T16',
  customerName: 'NC',
  customerMobile: '',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
  notes: 'COMPLIMENTARY\nMODE:DINE',
});
logic.markPaid(ncSale.id, 'OTHER');
const afterReport = logic.reportRange(todayYmd, todayYmd);
assert.equal(afterReport.bills, beforeReport.bills + 3);
assert.equal(afterReport.complimentary, beforeReport.complimentary + 1);
assert.equal(afterReport.ncAmount, beforeReport.ncAmount + ncSale.total);
assert.equal(afterReport.byChannel.pickup.amount, beforeReport.byChannel.pickup.amount + pickupSale.total);
assert.equal(afterReport.byChannel.delivery.amount, beforeReport.byChannel.delivery.amount + deliverySale.total);
assert.equal(afterReport.byMethod.CASH, beforeReport.byMethod.CASH + pickupSale.total);
assert.equal(afterReport.byMethod.UPI, beforeReport.byMethod.UPI + deliverySale.total);
assert.equal(afterReport.byMethod.OTHER, beforeReport.byMethod.OTHER);
assert.ok(afterReport.tickets.some((row) => row.id === pickupSale.id && row.channel === 'pickup'));
assert.ok(afterReport.tickets.some((row) => row.id === deliverySale.id && row.channel === 'delivery'));
assert.ok(afterReport.tickets.some((row) => row.id === ncSale.id && row.complimentary));
assert.ok(afterReport.items.some((row) => row.name === 'Espresso' && row.qty >= 2));
const yesterdayReport = logic.reportRange(shiftYmd(todayYmd, -1), shiftYmd(todayYmd, -1));
assert.ok(!yesterdayReport.tickets.some((row) => row.id === pickupSale.id || row.id === deliverySale.id || row.id === ncSale.id));

const guest = logic.createCustomer('Riya', '9876500555');
assert.equal(guest.orderCount, 0);
assert.equal(guest.spent, 0);
const t17 = logic.listTables().find((table) => table.name === 'T17');
assert.ok(t17);
const hold = logic.createReservation({ tableId: t17!.id, customerName: 'Riya', customerMobile: '9876500555', covers: 4 });
assert.equal(hold.covers, 4);
const reserved = logic.listTables().find((table) => table.name === 'T17');
assert.equal(tableVisualState(reserved!), 'reserved');
assert.equal(reserved?.reservation?.customerName, 'Riya');
assert.throws(() => logic.createReservation({ tableId: t17!.id, customerName: 'Other', covers: 2 }), /already reserved/);
const seated = logic.createStaffOrder({
  tableCode: 'T17',
  customerName: 'Riya',
  customerMobile: '9876500555',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
assert.equal(seated.tableName, 'T17');
assert.equal(logic.listTables().find((table) => table.name === 'T17')?.reservation, null);
assert.equal(tableVisualState(logic.listTables().find((table) => table.name === 'T17')!), 'running');
const afterVisit = logic.listCustomers().find((customer) => customer.mobile === '9876500555');
assert.ok((afterVisit?.orderCount ?? 0) >= 1);
assert.ok((afterVisit?.spent ?? 0) >= seated.total);
const t19 = logic.listTables().find((table) => table.name === 'T19');
assert.ok(t19);
const holdTwo = logic.createReservation({ tableId: t19!.id, customerName: 'Wait', covers: 2 });
logic.cancelReservation(holdTwo.id);
assert.equal(logic.listTables().find((table) => table.name === 'T19')?.reservation, null);

const firstTableBill = logic.createStaffOrder({
  tableCode: 'T20',
  customerName: 'Michael',
  customerMobile: '9876500777',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
const secondTableBill = logic.placeGuestOrder({
  tableCode: 'T20',
  customerName: 'Olise',
  customerMobile: '9876500778',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
assert.equal(secondTableBill.id, firstTableBill.id);
assert.equal(secondTableBill.items.length, 1);
assert.equal(secondTableBill.items[0].quantity, 2);
const thirdTableBill = logic.placeGuestOrder({
  tableCode: 'T20',
  customerName: 'Olise',
  customerMobile: '9876500778',
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
});
assert.equal(thirdTableBill.id, firstTableBill.id);
assert.equal(thirdTableBill.items.length, 2);
assert.equal(logic.listOrders().filter((order) => order.tableName === 'T20' && ['CONFIRMED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status)).length, 1);

const otpCombine = await logic.startCheckout({
  tableCode: 'T18',
  customerName: 'Neel',
  customerMobile: '9876500779',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
const otpCombineCode = otp.peekDevCode(otpCombine.challengeId!);
assert.ok(otpCombineCode);
const firstOtpBill = await logic.verifyCheckout(otpCombine.order.id, otpCombineCode);
const otpAgain = await logic.startCheckout({
  tableCode: 'T18',
  customerName: 'Kabir',
  customerMobile: '9876500780',
  items: [{ menuItemId: 'item_club_sandwich', quantity: 1, addonIds: [] }],
});
const otpAgainCode = otp.peekDevCode(otpAgain.challengeId!);
assert.ok(otpAgainCode);
const combinedOtpBill = await logic.verifyCheckout(otpAgain.order.id, otpAgainCode);
assert.equal(combinedOtpBill.id, firstOtpBill.id);
assert.equal(combinedOtpBill.items.length, 2);
assert.equal(logic.getOrder(otpAgain.order.id)?.status, 'CANCELLED');

logic.markPaid(thirdTableBill.id, 'UPI');
const afterPaid = logic.placeGuestOrder({
  tableCode: 'T20',
  customerName: 'Next',
  customerMobile: '9876500781',
  items: [{ menuItemId: 'item_espresso', quantity: 1, addonIds: [] }],
});
assert.notEqual(afterPaid.id, thirdTableBill.id);
assert.equal(afterPaid.items.length, 1);

const gym = await import('./gymkhana');
const slot = '2026-12-01T04:30:00.000Z';
const firstBooking = gym.createBooking({
  facilityId: 'fac_badminton',
  memberName: 'Overlap A',
  startAt: slot,
  payNow: false,
}, 'test');
assert.equal(firstBooking.status, 'CONFIRMED');
assert.throws(() => gym.createBooking({
  facilityId: 'fac_badminton',
  memberName: 'Overlap B',
  startAt: slot,
  payNow: false,
}, 'test'), /already booked/);
const statusBooking = gym.createBooking({
  facilityId: 'fac_tennis',
  memberName: 'Status Edit',
  startAt: '2026-12-02T04:30:00.000Z',
  payNow: false,
}, 'test');
assert.equal(gym.updateBooking(statusBooking.id, { status: 'CHECKED_IN' }, 'test').status, 'CHECKED_IN');
assert.equal(gym.updateBooking(statusBooking.id, { status: 'COMPLETED' }, 'test').status, 'COMPLETED');
assert.equal(gym.updateBooking(statusBooking.id, { status: 'CONFIRMED' }, 'test').status, 'CONFIRMED');

const { normalizeSlots, slotsBetween, summarizeSlots } = await import('../shared/slots');
assert.equal(summarizeSlots(slotsBetween(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 6, 11)), 'Mon–Sat 06:00–11:00');
assert.equal(summarizeSlots(['Wed 07:00', 'Mon 07:00', 'Mon 08:00', 'Mon 18:00']), 'Mon 07:00–09:00, 18:00–19:00 · Wed 07:00–08:00');
assert.deepEqual(normalizeSlots(['Sun 06:00', 'Mon 25:00', 'Mon 06:00', 'Mon 06:00']), ['Mon 06:00', 'Sun 06:00']);

const { env: testEnv } = await import('./env');
const { createHmac } = await import('node:crypto');
const { run: runSql } = await import('./db');
const joinBase = { email: 'join@example.com', dob: '1995-04-12', govtIdType: 'Aadhaar', govtIdNumber: '1234 5678 9012' };
const joinOptions = gym.joinOptions();
assert.ok(joinOptions.sports.some((row) => row.sport === 'Badminton'));
assert.deepEqual(
  gym.activityBoard().map((row) => row.sport),
  ['Badminton', 'Basketball', 'Football', 'Gym', 'Skating', 'Swimming', 'Tennis', 'Table tennis'],
);
const { matchArena, sportFromSlug } = await import('../shared/activities');
assert.equal(matchArena('Table Tennis 1'), 'Table tennis');
assert.equal(matchArena('Tennis Court 1'), 'Tennis');
assert.equal(sportFromSlug('skating'), 'Skating');
assert.equal(sportFromSlug('table-tennis'), 'Table tennis');
assert.ok(joinOptions.trainers.find((row) => row.id === 'trainer_head')?.freeSlots.includes('Mon 07:00'));
assert.throws(() => gym.createJoinRequest({ ...joinBase, sport: 'Badminton', name: 'No Plan', mobile: '9876543209' }), /membership plan/);
assert.throws(() => gym.createJoinRequest({ ...joinBase, dob: '2099-01-01', sport: 'Badminton', name: 'Future', mobile: '9876543209', planId: 'plan_monthly' }), /date of birth/);

const deskJoin = gym.createJoinRequest({ ...joinBase, sport: 'badminton', name: 'Tara Joshi', mobile: '98765 43210', wantsTrainer: false, planId: 'plan_monthly' });
assert.equal(deskJoin.status, 'NEW');
assert.equal(deskJoin.amount, 2625);
const deskFull = gym.getJoinRequest(deskJoin.id);
assert.equal(deskFull.route, 'STAFF');
assert.equal(deskFull.sport, 'Badminton');
assert.equal(deskFull.govtIdLabel, 'Aadhaar · ending 9012');
assert.equal(gym.createJoinRequest({ ...joinBase, sport: 'Badminton', name: 'Tara Joshi', mobile: '9876543210', planId: 'plan_monthly' }).id, deskJoin.id);
assert.throws(() => gym.approveJoinRequest(deskJoin.id, undefined, 'desk'), /cash, UPI, or card/);
assert.equal(gym.markJoinContacted(deskJoin.id, 'desk').status, 'CONTACTED');
const deskApproved = gym.approveJoinRequest(deskJoin.id, 'CASH', 'desk');
assert.equal(deskApproved.status, 'APPROVED');
assert.equal(deskApproved.paymentStatus, 'PAID');
assert.equal(gym.memberProfile(deskApproved.customerId).member.membershipStatus, 'ACTIVE');
const sessionAt = new Date('2027-08-20T09:00:00+05:30').toISOString();
const sessionReq = gym.createSessionRequest(deskApproved.customerId, { sport: 'Badminton', startAt: sessionAt, purpose: 'Practice', remarks: 'Court 2' });
assert.equal(sessionReq.kind, 'SESSION');
assert.equal(sessionReq.sport, 'Badminton');
assert.match(sessionReq.notes, /Practice/);
assert.equal(gym.listMemberSessions(deskApproved.customerId)[0]?.id, sessionReq.id);
assert.equal(gym.approveJoinRequest(sessionReq.id, undefined, 'desk').status, 'APPROVED');
const filedReport = gym.createReportRequest(deskApproved.customerId, { issue: 'Net torn on court 1', remarks: 'After evening play' });
assert.equal(filedReport.kind, 'REPORT');
assert.match(filedReport.notes, /Net torn/);
assert.equal(gym.approveJoinRequest(filedReport.id, undefined, 'desk').status, 'APPROVED');

const trainerJoin = gym.createJoinRequest({ ...joinBase, sport: 'Badminton', name: 'Ira Sen', mobile: '9876543211', wantsTrainer: true, trainerId: 'trainer_head', preferredSlot: 'Mon 07:00', planId: 'plan_quarterly' });
assert.equal(gym.getJoinRequest(trainerJoin.id).route, 'TRAINER');
assert.equal(trainerJoin.preferredSlotLabel, 'Mon 07:00–08:00');
testEnv.razorpayKeyId = 'rzp_test_key';
testEnv.razorpayKeySecret = 'rzp_test_secret';
const signJoin = (orderId: string, paymentId: string) => createHmac('sha256', 'rzp_test_secret').update(`${orderId}|${paymentId}`).digest('hex');
runSql(`UPDATE join_requests SET razorpay_order_id = 'order_join_1' WHERE id = ?`, [trainerJoin.id]);
assert.throws(() => gym.confirmJoinPayment(trainerJoin.id, 'order_join_1', 'pay_join_1', 'forged'), /verification failed/);
assert.throws(() => gym.confirmJoinPayment(trainerJoin.id, 'order_other', 'pay_join_1', signJoin('order_other', 'pay_join_1')), /does not match/);
const paidJoin = gym.confirmJoinPayment(trainerJoin.id, 'order_join_1', 'pay_join_1', signJoin('order_join_1', 'pay_join_1'));
assert.equal(paidJoin.paymentStatus, 'PAID');
assert.equal(paidJoin.status, 'NEW');
assert.equal(gym.confirmJoinPayment(trainerJoin.id, 'order_join_1', 'pay_join_1', signJoin('order_join_1', 'pay_join_1')).paymentStatus, 'PAID');
const trainerApproved = gym.approveJoinRequest(trainerJoin.id, undefined, 'Neha Kapoor');
assert.equal(gym.memberProfile(trainerApproved.customerId).member.coachId, 'trainer_head');
assert.ok(!gym.joinOptions().trainers.find((row) => row.id === 'trainer_head')?.freeSlots.includes('Mon 07:00'));
assert.throws(() => gym.createJoinRequest({ ...joinBase, sport: 'Badminton', name: 'Late Comer', mobile: '9876543212', wantsTrainer: true, trainerId: 'trainer_head', preferredSlot: 'Mon 07:00', planId: 'plan_monthly' }), /no longer free/);

const refundJoin = gym.createJoinRequest({ ...joinBase, sport: 'Tennis', name: 'Dev Rao', mobile: '9876543213', planId: 'plan_monthly' });
runSql(`UPDATE join_requests SET razorpay_order_id = 'order_join_2' WHERE id = ?`, [refundJoin.id]);
gym.confirmJoinPayment(refundJoin.id, 'order_join_2', 'pay_join_2', signJoin('order_join_2', 'pay_join_2'));
const declined = gym.declineJoinRequest(refundJoin.id, 'Plan not suitable', 'desk', 'Plan not suitable\nWants evening tennis only');
assert.equal(declined.request.status, 'DECLINED');
assert.equal(declined.request.notes, 'Plan not suitable\nWants evening tennis only');
assert.equal(declined.request.paymentStatus, 'REFUNDED');
assert.match(declined.note, /Razorpay/);
testEnv.razorpayKeyId = '';
testEnv.razorpayKeySecret = '';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
assert.throws(() => gym.createJoinRequest({
  signup: true,
  firstName: 'No',
  lastName: 'Id',
  email: 'noid@gymkhana.local',
  pincode: '400001',
  sport: 'Gym',
  photoUrl: pixel,
}), /government ID/);
const signup = gym.createJoinRequest({
  signup: true,
  firstName: 'Nikita',
  lastName: 'Volkov',
  email: 'nikita@gymkhana.local',
  pincode: '400001',
  sport: 'Skating',
  photoUrl: pixel,
  govtIdUrl: pixel,
  wantsTrainer: true,
  becomeMember: true,
});
assert.equal(signup.status, 'NEW');
assert.equal(signup.wantsTrainer, true);
const signupFull = gym.getJoinRequest(signup.id);
assert.equal(signupFull.route, 'TRAINER');
assert.equal(signupFull.sport, 'Skating');
assert.equal(signupFull.name, 'Nikita Volkov');
assert.equal(signupFull.pincode, '400001');
assert.equal(signupFull.becomeMember, true);
assert.equal(signupFull.trainerName, '');
assert.throws(() => gym.approveJoinRequest(signup.id, 'CASH', 'desk'), /trainer/i);
const trainerDeskOk = gym.approveJoinRequest(signup.id, undefined, 'Neha Kapoor', undefined, 'trainer_imran');
assert.equal(trainerDeskOk.status, 'APPROVED');
assert.equal(trainerDeskOk.trainerId, 'trainer_imran');
assert.ok(trainerDeskOk.planId);
assert.equal(gym.memberProfile(trainerDeskOk.customerId).member.coachId, 'trainer_imran');
const assigned = gym.getJoinRequest(signup.id);
assert.equal(assigned.trainerId, 'trainer_imran');
assert.ok(assigned.planId);

const deskSignup = gym.createJoinRequest({
  signup: true,
  firstName: 'Oksana',
  lastName: 'Petrov',
  email: 'oksana@gymkhana.local',
  pincode: '110001',
  sport: 'Gym',
  photoUrl: pixel,
  govtIdUrl: pixel,
  wantsTrainer: false,
  isMember: true,
});
assert.equal(gym.getJoinRequest(deskSignup.id).route, 'STAFF');

const pendingGate = gym.saveMember({ name: 'No Plan Yet', mobile: '9876500888' }, 'test');
assert.equal(pendingGate.member.membershipStatus, 'PENDING');
assert.throws(() => gym.checkIn({ query: pendingGate.member.id, facilityName: 'Gym' }, 'test'), /Only members can go in/);
assert.throws(() => gym.checkIn({ query: pendingGate.member.id, facilityName: 'Gym', fromGate: true }, 'test'), /Only members can go in/);
assert.throws(() => gym.checkIn({ query: pendingGate.member.id, facilityName: 'Gym', payFee: true, method: 'CASH', guestFee: 200 }, 'test'), /Only members can go in/);
const memberIn = gym.checkIn({ query: deskApproved.customerId, facilityName: 'Badminton Court 1' }, 'test');
assert.ok(memberIn.checkInId);
assert.equal(memberIn.profile.member.membershipStatus, 'ACTIVE');

assert.throws(() => gym.importMembersCsv('name,email\nAsha,a@b.com', 'test'), /name and mobile/);
const csvImport = gym.importMembersCsv(
  'Name,Phone,Email,Plan,Activity,Trainer,Notes\n"Menon, Asha",9811199001,asha.csv@gymkhana.test,Monthly,Badminton,Neha Kapoor,From CSV\nKabir Seth,9811199002,,Quarterly,Gym,,\nIra Nair,9811199005,,,Gym,,\nKabir Twin,9811199002,,,Gym,,\nNo Plan,9876500888,,,Gym,,\nBad Plan,9811199003,,Gold,Gym,,\n,9811199004,,,,\nShort,12,,,,\n',
  'test',
);
assert.equal(csvImport.created, 3);
assert.equal(csvImport.skipped, 2);
assert.ok(csvImport.errors.some((row) => /Unknown plan/.test(row.reason)));
assert.ok(csvImport.errors.some((row) => /member name/.test(row.reason)));
assert.ok(csvImport.errors.some((row) => /10-digit/.test(row.reason)));
const ashaCsv = gym.listMembers('all', '9811199001').find((row) => row.mobile === '9811199001');
assert.equal(ashaCsv?.name, 'Menon, Asha');
assert.equal(ashaCsv?.planName, 'Monthly');
assert.equal(ashaCsv?.coachName, 'Neha Kapoor');
assert.equal(ashaCsv?.accessInterest, 'Badminton');
const kabirCsv = gym.listMembers('all', '9811199002').find((row) => row.mobile === '9811199002');
assert.equal(kabirCsv?.membershipStatus, 'ACTIVE');
const iraCsv = gym.listMembers('all', '9811199005').find((row) => row.mobile === '9811199005');
assert.equal(iraCsv?.membershipStatus, 'PENDING');

const pass = gym.memberPass(deskApproved.customerId);
assert.equal(gym.readMemberId(undefined, pass), deskApproved.customerId);
assert.equal(gym.readMemberId(`gym_member=${encodeURIComponent(pass)}`), deskApproved.customerId);
assert.ok(gym.memberCookie(deskApproved.customerId, pass).includes('Max-Age=34560000'));
assert.throws(() => gym.scanActivityGate('badminton'), /Register once on this phone/);
const gateByPass = gym.scanActivityGate('tennis', undefined, pass);
assert.equal(gateByPass.sport, 'Tennis');
assert.equal(gateByPass.name, gym.memberProfile(deskApproved.customerId).member.name);
const gateByCookie = gym.scanActivityGate('table-tennis', `gym_member=${encodeURIComponent(pass)}`);
assert.equal(gateByCookie.sport, 'Table tennis');
assert.equal(gateByCookie.already, false);
const doorIn = gym.scanActivityGate('', undefined, pass);
assert.equal(doorIn.door, true);
assert.ok(doorIn.sport);
assert.ok(doorIn.facility);
assert.equal(doorIn.name, gym.memberProfile(deskApproved.customerId).member.name);
const insideNow = gym.listMembers('in').find((row) => row.id === deskApproved.customerId);
assert.ok(insideNow);
assert.equal(insideNow.hereNow, doorIn.facility);
assert.equal(insideNow.hereSport, doorIn.sport);

assert.equal(fillTemplate('Hello {{name}}, id {{membership_id}}.', { name: 'Asha', membership_id: 'GK1' }), 'Hello Asha, id GK1.');
const comms = await import('./comms');
assert.ok(ashaCsv);
comms.setConsent(ashaCsv.id, { status: 'OPT_IN', marketingStatus: 'OPT_IN', source: 'test' }, 'test');
const readyPreview = comms.previewCampaign({
  templateKey: 'announcement',
  audience: 'selected',
  memberIds: [ashaCsv.id],
  extras: { headline: 'Pool closed', details: 'Tomorrow' },
});
assert.equal(readyPreview.recipientCount, 1);
assert.match(readyPreview.previews[0]?.preview ?? '', /Pool closed/);
comms.setConsent(ashaCsv.id, { status: 'OPT_OUT', source: 'test' }, 'test');
const blocked = comms.previewCampaign({
  templateKey: 'announcement',
  audience: 'selected',
  memberIds: [ashaCsv.id],
  extras: { headline: 'Pool closed', details: 'Tomorrow' },
});
assert.equal(blocked.recipientCount, 0);
assert.equal(blocked.excluded[0]?.reason, 'Opted out');
comms.setConsent(ashaCsv.id, { status: 'OPT_IN', marketingStatus: 'OPT_IN', source: 'test' }, 'test');
const queued = comms.createCampaign({
  name: 'Pool notice',
  templateKey: 'announcement',
  audience: 'selected',
  memberIds: [ashaCsv.id],
  extras: { headline: 'Pool closed', details: 'Tomorrow' },
  confirm: true,
  actor: 'test',
});
assert.ok(queued.campaignId);
assert.equal(queued.recipientCount, 1);
const overview = comms.commsOverview();
assert.equal(overview.eligible >= 1, true);
assert.equal(overview.pending >= 1, true);
assert.equal(overview.delivered, 0);
const unknown = gym.listMembers('wa_unknown');
assert.ok(unknown.every((row) => row.consentStatus === 'UNKNOWN'));
const opted = gym.listMembers('wa_opted_in').find((row) => row.id === ashaCsv.id);
assert.equal(opted?.consentStatus, 'OPT_IN');

console.log('server tests passed');
