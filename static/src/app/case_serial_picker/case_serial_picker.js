/** @odoo-module **/
// Case picker: opens automatically when the cashier clicks a NON-tracked product
// (tracking="none") that has more than one unit on hand today - possibly in
// different cases. Serial/lot-tracked products never open this: native Odoo already
// asks for the lot/serial on its own and resolves the case from it (pack_lot_ids) -
// pre-picking a serial here only duplicated a prompt the cashier would see again
// right after at payment, so that path was removed rather than kept (see store.js
// darakjianNeedsCasePicker).
//
// It is scoped to ONE product template (set by ProductScreen.addProductToOrder, see
// the override in overrides/product_screen.js): the cases and quantities shown here
// belong to that product and no other.
//
// Data comes from stock.quant + stock.location, loaded into the POS by
// models/pos_session.py (StockQuant/StockLocation). No server round-trip here: both
// models are already in `pos.models` when the session opens.

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

export class DarakjianCaseSerialPicker extends Component {
    static template = "yaguven_darakjian_pos_nav.CaseSerialPicker";
    static props = {};

    setup() {
        this.pos = usePos();
    }

    _rel(val) {
        return val && val.id !== undefined ? val.id : val;
    }

    get isOpen() {
        return !!this.pos.darakjianCasePickerProduct;
    }

    get product() {
        return this.pos.darakjianCasePickerProduct;
    }

    get productQuants() {
        return this.pos.darakjianQuantsForTemplate(this.product);
    }

    /** Cases that hold this product today, with the real on-hand quantity in each
     *  (sum of quantity, not a count of quant rows - a case can hold the same product
     *  across more than one quant record). */
    get casesForProduct() {
        const locModel = this.pos.models["stock.location"];
        if (!locModel || !this.product) {
            return [];
        }
        const qtyByLoc = {};
        for (const q of this.productQuants) {
            const locId = this._rel(q.location_id);
            qtyByLoc[locId] = (qtyByLoc[locId] || 0) + q.quantity;
        }
        return locModel
            .getAll()
            .filter((loc) => qtyByLoc[loc.id])
            .map((loc) => ({ id: loc.id, name: loc.name, count: qtyByLoc[loc.id] }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Picking a case IS the whole interaction for a non-tracked product: add it to
     *  the order with that case forced as the source, and close. */
    selectCase(caseId) {
        this.pos.addLineToCurrentOrder(
            {
                product_tmpl_id: this.product,
                darakjian_source_location_id: Number(caseId),
            },
            {}
        );
        this.close();
    }

    close() {
        this.pos.darakjianCasePickerProduct = null;
    }
}
