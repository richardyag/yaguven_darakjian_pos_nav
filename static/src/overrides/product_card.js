/** @odoo-module **/
// Declares the extra prop the stock badge needs. OWL validates props strictly in
// debug mode - passing darakjianStockQty from product_screen.xml without adding it
// here throws "unknown prop" instead of silently working.

import { patch } from "@web/core/utils/patch";
import { ProductCard } from "@point_of_sale/app/components/product_card/product_card";

patch(ProductCard.props, {
    darakjianStockQty: { type: [Number, undefined], optional: true },
});
