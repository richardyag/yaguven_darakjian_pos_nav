/** @odoo-module **/
// Case/Serial picker: opens automatically when the cashier clicks a product that has
// more than one unit on hand today - possibly in different cases, possibly under
// different serials - so which exact piece is being sold is never ambiguous.
//
// It is scoped to ONE product template (set by ProductScreen.addProductToOrder,
// see the override in overrides/product_screen.js): everything shown here - cases,
// serials - belongs to that product and no other. A product with 0 or 1 unit on
// hand never triggers this at all; it is added the native way, exactly as before.
//
// Data comes from stock.quant + stock.location, loaded into the POS by
// models/pos_session.py (StockQuant/StockLocation). No server round-trip here: both
// models are already in `pos.models` when the session opens.

import { Component, useState } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

export class DarakjianCaseSerialPicker extends Component {
    static template = "yaguven_darakjian_pos_nav.CaseSerialPicker";
    static props = {};

    setup() {
        this.pos = usePos();
        this.state = useState({
            selectedCaseId: null,
            // True only when the case was set BY a serial match - locks the Case
            // selection so picking a different case by hand does not silently
            // contradict the serial that was just typed.
            caseLockedBySerial: false,
            serialInput: "",
        });
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

    /** Every quant of THIS product only - never another one. */
    get productQuants() {
        const product = this.product;
        const quantModel = this.pos.models["stock.quant"];
        if (!product || !quantModel) {
            return [];
        }
        const variantIds = (product.product_variant_ids || []).map((v) => this._rel(v));
        return quantModel.getAll().filter((q) => variantIds.includes(this._rel(q.product_id)));
    }

    /** Cases that hold this product today - not the full case list.
     *  count is the actual on-hand QUANTITY in that case, not the number of quant
     *  rows: a case can hold the same product as two separate quant records (two
     *  receiving batches that never got merged into one), and counting rows instead
     *  of summing quantity showed e.g. "Receiving & Sorting (2)" for a case that
     *  actually holds 55 units (47 in one batch, 8 in another). */
    get casesForProduct() {
        const locModel = this.pos.models["stock.location"];
        if (!locModel) {
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

    /** What's physically in the selected case, for this product only. */
    get itemsInSelectedCase() {
        if (!this.state.selectedCaseId) {
            return [];
        }
        return this.productQuants
            .filter((q) => this._rel(q.location_id) === this.state.selectedCaseId)
            .map((q) => this._describeQuant(q));
    }

    /** Serial search within this product's own quants only. */
    get serialMatches() {
        const term = this.state.serialInput.trim().toLowerCase();
        if (!term) {
            return this.productQuants.filter((q) => q.lot_id).map((q) => this._describeQuant(q));
        }
        return this.productQuants
            .filter((q) => q.lot_id && String(q.lot_id.name || "").toLowerCase().includes(term))
            .map((q) => this._describeQuant(q));
    }

    _describeQuant(q) {
        return {
            quantId: q.id,
            lotId: q.lot_id ? this._rel(q.lot_id) : null,
            lotName: q.lot_id ? q.lot_id.name : null,
            locationId: this._rel(q.location_id),
            quantity: q.quantity,
        };
    }

    onSerialInput(ev) {
        const value = ev.target.value;
        this.state.serialInput = value;
        if (!value.trim()) {
            this.state.caseLockedBySerial = false;
            return;
        }
        const exact = this.productQuants.find(
            (q) => q.lot_id && String(q.lot_id.name || "").toLowerCase() === value.trim().toLowerCase()
        );
        if (exact) {
            this.state.selectedCaseId = this._rel(exact.location_id);
            this.state.caseLockedBySerial = true;
        } else {
            this.state.caseLockedBySerial = false;
        }
    }

    selectCase(caseId) {
        if (this.state.caseLockedBySerial) {
            return;
        }
        // <select> values are always strings; location ids coming out of _rel()
        // are numbers. Without this cast, itemsInSelectedCase's === comparison
        // never matches and the case always looks empty.
        this.state.selectedCaseId = caseId ? Number(caseId) : null;
    }

    clearAll() {
        this.state.serialInput = "";
        this.state.caseLockedBySerial = false;
        this.state.selectedCaseId = null;
    }

    /** Adds THIS component's product, with the piece the cashier picked, to the
     *  current order, then closes.
     *  - Has a lot (serial-tracked): pack_lot_ids does the work, same as native POS -
     *    Odoo's own stock logic already resolves the case from the lot.
     *  - No lot (tracking=none): darakjian_source_location_id is what forces the
     *    case, since Odoo has nothing else to go on for that product. */
    pickItem(item) {
        const vals = { product_tmpl_id: this.product };
        if (item.lotId) {
            vals.pack_lot_ids = [["create", { lot_name: item.lotName }]];
        } else {
            vals.darakjian_source_location_id = item.locationId;
        }
        this.pos.addLineToCurrentOrder(vals, {});
        this.close();
    }

    close() {
        this.pos.darakjianCasePickerProduct = null;
        this.clearAll();
    }
}
