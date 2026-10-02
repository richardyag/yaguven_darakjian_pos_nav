# -*- coding: utf-8 -*-
from odoo import models


class PosOrder(models.Model):
    """Bridges the PIN-selected cashier to the invoice's salesperson.

    Native Odoo 19: _prepare_invoice_vals() sets invoice_user_id to self.user_id - the
    Odoo login that owns the POS SESSION, never the employee selected by PIN at the
    register. In this store there is effectively one real login (Administrator), so
    every invoice ended up attributed to Administrator regardless of who actually rang
    it up - and the commissions module (yaguven_darakjian_comisiones) keys off exactly
    this field, so no PIN-only cashier could ever get commission credit.

    This only takes effect for employees that DO have a linked res.users (Janel, Armen,
    as of 2026-10-01) - everyone else still falls back to the session owner, same as
    before. Deliberately placed here, not in the commissions module: that module is
    documented as a read-only datasource over native models and this changes how a
    native model (pos.order) behaves.
    """

    _inherit = "pos.order"

    def _prepare_invoice_vals(self):
        vals = super()._prepare_invoice_vals()
        salesperson_user = self.employee_id.user_id
        if salesperson_user:
            vals["invoice_user_id"] = salesperson_user.id
        return vals
