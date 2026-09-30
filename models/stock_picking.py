# -*- coding: utf-8 -*-
from odoo import models


class StockPicking(models.Model):
    """Force the source case when the cashier picked one explicitly.

    Native point_of_sale (addons/point_of_sale/models/stock_picking.py) groups order
    lines into one move per (product, attributes) and reserves each move against the
    picking's single, broad location_id (the whole "WWH" tree) - there is no per-line
    location choice for non-serial-tracked products.

    For serial-tracked products this is already solved natively through
    pack_lot_ids: Odoo's own _add_mls_related_to_order searches the exact
    stock.quant by lot_id + location, so a scanned/typed serial already resolves to
    the right case without any override here.

    This override only changes the split for lines where darakjian_source_location_id
    was set by the Case/Serial picker AND the product has no tracking (the case that
    native Odoo cannot resolve on its own): those lines get their own move, forced to
    that exact case, instead of being merged into the generic reservation.
    """

    _inherit = "stock.picking"

    def _create_move_from_pos_order_lines(self, lines):
        self.ensure_one()
        forced_groups = {}
        plain_lines = self.env["pos.order.line"]
        for line in lines:
            if line.darakjian_source_location_id and line.product_id.tracking == "none":
                loc_id = line.darakjian_source_location_id.id
                forced_groups.setdefault(loc_id, self.env["pos.order.line"])
                forced_groups[loc_id] |= line
            else:
                plain_lines |= line

        if plain_lines:
            super(StockPicking, self)._create_move_from_pos_order_lines(plain_lines)
        for loc_id, loc_lines in forced_groups.items():
            forced_self = self.with_context(darakjian_force_source_location_id=loc_id)
            super(StockPicking, forced_self)._create_move_from_pos_order_lines(loc_lines)

    def _prepare_stock_move_vals(self, first_line, order_lines):
        vals = super()._prepare_stock_move_vals(first_line, order_lines)
        forced_location_id = self.env.context.get("darakjian_force_source_location_id")
        if forced_location_id:
            vals["location_id"] = forced_location_id
        return vals
