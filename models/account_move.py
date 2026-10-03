# -*- coding: utf-8 -*-
from odoo import models


class AccountMoveLine(models.Model):
    """Feeds the simplified serial list under each product line on the printed
    invoice (see views/account_move_report.xml). Standard Odoo's own serial box
    (stock_account's "Display Serial & Lot Number on Invoices") lists every serial
    sold on the invoice in one combined table, with no way to tell which line each
    one belongs to — confusing on a multi-line invoice. This mirrors point_of_sale's
    own `_get_invoiced_lot_values` matching (by product, against the POS order lines
    behind this invoice), but scoped to a single line instead of the whole invoice."""

    _inherit = "account.move.line"

    def _darakjian_invoice_serials(self):
        self.ensure_one()
        move = self.move_id
        if not move.pos_order_ids:
            return []
        pos_lines = move.sudo().pos_order_ids.lines.filtered(
            lambda l: l.product_id == self.product_id and l.pack_lot_ids
        )
        return pos_lines.pack_lot_ids.mapped("lot_name")
