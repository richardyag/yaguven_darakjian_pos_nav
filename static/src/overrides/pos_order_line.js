/** @odoo-module **/
// Weight (g) lives on the serial (stock.lot, yaguven_darakjian_etiquetas), not on the
// product: the same chain model sells at a different weight piece to piece, since it is
// priced by precious metal, not by a manufactured tolerance. A product attribute would
// mean a new value - and for serial-tracked metal, a new variant - for every gram the
// scale happens to read, which is exactly what was ruled out when this was designed.
//
// The native Orderline component already prints one line per pack_lot_ids entry
// ("SN <serial>" / "Lot Number <serial>") on BOTH the cart and the printed receipt -
// point_of_sale.Orderline reads line.packLotLines for both (see order_receipt.xml and
// orderline.xml, mode="receipt" vs "display"). Appending the weight inside that same
// getter, instead of adding a template slot, means one patch reaches both places and
// stays a plain string: no new DOM, no xpath to repoint on the next Odoo upgrade.
import { patch } from "@web/core/utils/patch";
import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";

patch(PosOrderline.prototype, {
    get packLotLines() {
        const lines = [];
        for (const l of this.pack_lot_ids) {
            lines.push(
                `${l.pos_order_line_id.product_id.tracking == "lot" ? "Lot Number" : "SN"} ${
                    l.lot_name
                }`
            );
            // Matched by name, not by id: pack_lot_ids is the order line's own record
            // (pos.pack.operation.lot, created client-side from the typed/picked serial
            // name), while the weight sits on the catalogue's stock.lot - the two meet
            // only through the serial text they share.
            const lot = this.models["stock.lot"]
                .getAll()
                .find((candidate) => candidate.name === l.lot_name);
            if (lot && lot.weight_grams) {
                lines.push(`Weight ${lot.weight_grams.toFixed(2)} g`);
            }
        }
        return lines;
    },
});
