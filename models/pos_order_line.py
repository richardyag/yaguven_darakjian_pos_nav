# -*- coding: utf-8 -*-
from odoo import fields, models


class PosOrderLine(models.Model):
    """Where the piece actually came from, when the cashier chose it explicitly.

    For serial-tracked products, native Odoo already resolves the right case: the
    lot/serial chosen in `pack_lot_ids` is enough for `_add_mls_related_to_order`
    (point_of_sale/models/stock_picking.py) to search the exact stock.quant by
    lot_id + location. No override needed for that path.

    For non-tracked products (the majority of the catalog, ~87%), Odoo has no
    concept of "which physical unit" was sold - it just reserves against whatever
    the picking's single location_id can supply. This field is the only way to
    force a *specific* case for those, when the cashier picked one on purpose
    (Darakjian Case/Serial picker) instead of letting the default apply.
    """

    _inherit = "pos.order.line"

    darakjian_source_location_id = fields.Many2one(
        "stock.location",
        string="Source Case (Darakjian)",
        help="Case the piece was picked from, when chosen explicitly through the "
             "Case/Serial picker. Only meaningful for non-serial-tracked products - "
             "serial-tracked ones are already resolved through pack_lot_ids.",
    )

    def _load_pos_data_fields(self, config):
        # Must be listed here for the field set on the frontend orderline to
        # actually reach the backend when the order syncs - otherwise the value
        # is silently dropped, since sync only serializes listed fields.
        fields_ = super()._load_pos_data_fields(config)
        if "darakjian_source_location_id" not in fields_:
            fields_ = list(fields_) + ["darakjian_source_location_id"]
        return fields_
