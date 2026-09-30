/** @odoo-module **/
// Case/Serial picker: a second, explicit way to add a product to the order, for when
// the cashier wants to say exactly which physical piece is being sold.
//
// Two entry points into the SAME list, kept in sync:
//  - Type/scan a serial -> the case it lives in is resolved and locked automatically
//    (a serial only ever lives in one place).
//  - Pick a case first -> only the pieces physically there are listed; picking one
//    with no serial (tracking=none) sells straight from that case.
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
            // dropdown so picking a different case by hand does not silently
            // contradict the serial that was just typed.
            caseLockedBySerial: false,
            serialInput: "",
        });
    }

    _rel(val) {
        return val && val.id !== undefined ? val.id : val;
    }

    get quants() {
        const model = this.pos.models["stock.quant"];
        return model ? model.getAll() : [];
    }

    /** Cases that actually have something today - not the full location list. */
    get casesWithStock() {
        const locModel = this.pos.models["stock.location"];
        if (!locModel) {
            return [];
        }
        const countByLoc = {};
        for (const q of this.quants) {
            const locId = this._rel(q.location_id);
            countByLoc[locId] = (countByLoc[locId] || 0) + 1;
        }
        return locModel
            .getAll()
            .filter((loc) => countByLoc[loc.id])
            .map((loc) => ({ id: loc.id, name: loc.name, count: countByLoc[loc.id] }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /** What's physically in the selected case, one row per quant (piece or batch). */
    get itemsInSelectedCase() {
        if (!this.state.selectedCaseId) {
            return [];
        }
        return this.quants
            .filter((q) => this._rel(q.location_id) === this.state.selectedCaseId)
            .map((q) => this._describeQuant(q));
    }

    /** Serial search: substring match against every lot in stock, case-insensitive.
     *  Only meaningful once at least a few characters were typed - listing every
     *  serial in the store on an empty input would be noise, not a search. */
    get serialMatches() {
        const term = this.state.serialInput.trim().toLowerCase();
        if (term.length < 2) {
            return [];
        }
        return this.quants
            .filter((q) => q.lot_id && String(q.lot_id.name || "").toLowerCase().includes(term))
            .map((q) => this._describeQuant(q));
    }

    _describeQuant(q) {
        const product = q.product_id;
        return {
            quantId: q.id,
            productId: this._rel(q.product_id),
            product,
            lotId: q.lot_id ? this._rel(q.lot_id) : null,
            lotName: q.lot_id ? q.lot_id.name : null,
            locationId: this._rel(q.location_id),
            quantity: q.quantity,
        };
    }

    onSerialInput(ev) {
        this.state.serialInput = ev.target.value;
        if (!ev.target.value.trim()) {
            this.state.caseLockedBySerial = false;
            return;
        }
        // Auto-lock: if the text typed so far already matches exactly one serial in
        // stock, jump straight to its case - the cashier does not have to also click
        // it in the list below for the common "I already know the serial" path.
        const exact = this.quants.find(
            (q) => q.lot_id && String(q.lot_id.name || "").toLowerCase() === this.state.serialInput.trim().toLowerCase()
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
            // A serial is driving the selection - clear it first if the cashier
            // really wants to browse a different case by hand.
            return;
        }
        this.state.selectedCaseId = caseId;
    }

    clearSerial() {
        this.state.serialInput = "";
        this.state.caseLockedBySerial = false;
    }

    clearCase() {
        this.state.selectedCaseId = null;
        this.state.caseLockedBySerial = false;
    }

    /** Adds the chosen piece to the current order and closes the picker.
     *  - Has a lot (serial-tracked): pack_lot_ids does the work, same as native POS -
     *    Odoo's own stock logic already resolves the case from the lot.
     *  - No lot (tracking=none): darakjian_source_location_id is what forces the
     *    case, since Odoo has nothing else to go on for that product. */
    pickItem(item) {
        const vals = {
            product_id: item.product,
            product_tmpl_id: item.product.product_tmpl_id,
        };
        if (item.lotId) {
            vals.pack_lot_ids = [["create", { lot_name: item.lotName }]];
        } else {
            vals.darakjian_source_location_id = item.locationId;
        }
        this.pos.addLineToCurrentOrder(vals, {});
        this.close();
    }

    open() {
        this.pos.darakjianCasePickerOpen = true;
    }

    close() {
        this.pos.darakjianCasePickerOpen = false;
        this.state.selectedCaseId = null;
        this.state.caseLockedBySerial = false;
        this.state.serialInput = "";
    }
}
