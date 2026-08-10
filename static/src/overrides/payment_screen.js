/** @odoo-module **/
// Refund fix - the negative sign on the payment screen:
// The cashier types 127, positive, which is the natural thing to do, but the system needs
// -127. triggerAtInput calls updateSelectedPaymentline on every keystroke; when the buffer
// holds a positive number on a refund order, we negate it before handing over to the
// native implementation.

import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";

patch(PaymentScreen.prototype, {
    updateSelectedPaymentline(amount = false) {
        if (this.isRefundOrder && amount === false) {
            const v = this.numberBuffer.getFloat();
            if (v !== null && v > 0) {
                return super.updateSelectedPaymentline(-v);
            }
        }
        return super.updateSelectedPaymentline(amount);
    },
});
