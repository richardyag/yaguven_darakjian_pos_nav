/** @odoo-module **/
// Every new sale should produce an invoice unless the cashier explicitly opts out.
// Native PosOrder.setup() does `this.to_invoice = vals.to_invoice || false;` — vals.to_invoice
// is only ever undefined for a brand-new order created client-side (orders loaded from the
// server, including past orders from this same session, always carry an explicit true/false),
// so checking `=== undefined` flips the default without touching historical orders.

import { patch } from "@web/core/utils/patch";
import { PosOrder } from "@point_of_sale/app/models/pos_order";

patch(PosOrder.prototype, {
    setup(vals) {
        super.setup(...arguments);
        if (vals.to_invoice === undefined) {
            this.to_invoice = true;
        }
    },
});
