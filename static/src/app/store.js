/** @odoo-module **/
// Reactive state for Darakjian's custom POS navigation: active facets, the tree overlay,
// and the client-side matching logic. It hooks into the native PosStore through a patch:
// we extend, we do not rewrite.

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/services/pos_store";

// Categories already loaded, or in flight, in this session - they prevent double loads.
const _dkLoadedCateg = new Set();
const _dkLoadingCateg = new Set();
// Cap on how many non-priority templates are fetched when entering a category. It bounds
// the volume so a huge category cannot hang the UI; everything beyond the cap stays
// reachable through the POS's native search.
const DK_CATEG_LIMIT = 50;

patch(PosStore.prototype, {
    // Odoo 19 pos_hr bug: getCashier() returns undefined before the employee is loaded
    // and then crashes on "_role" of undefined. Optional chaining makes it return false
    // instead of throwing.
    get employeeIsAdmin() {
        const cashier = this.getCashier?.();
        return cashier?._role === "manager";
    },

    setup() {
        super.setup(...arguments);
        // Active facets: { [String(attributeId)]: [valueId, ...] }
        this.darakjianFacets = {};
        // Overlay holding the vertical category tree.
        this.darakjianTreeOpen = false;
        // The product template the Case/Serial picker is currently resolving, or null
        // when closed. Set by ProductScreen.addProductToOrder (see overrides/
        // product_screen.js) only when that product has more than one unit on hand -
        // otherwise the native add-to-order flow runs untouched.
        this.darakjianCasePickerProduct = null;
    },

    /** Override of the getter that REALLY feeds the Odoo 19 POS grid.
     *  product_screen.xml iterates pos.productToDisplayByCateg, which derives from
     *  pos.productsToDisplay, a PosStore getter - NOT from the ProductScreen component's
     *  own `products` getter. That is why the facet filter has to be applied here to have
     *  any effect at all. */
    get productsToDisplay() {
        const base = super.productsToDisplay;
        if (!this.darakjianActiveFacetCount) {
            return base;
        }
        return base.filter((p) => this.darakjianProductMatches(p));
    },

    /** Toggles one facet value. The object is reassigned rather than mutated, because
     *  mutating in place does not always trigger OWL's reactivity. */
    darakjianToggleFacetValue(attributeId, valueId) {
        const key = String(attributeId);
        const cur = this.darakjianFacets[key] || [];
        const next = cur.includes(valueId)
            ? cur.filter((v) => v !== valueId)
            : [...cur, valueId];
        const all = { ...this.darakjianFacets };
        if (next.length) {
            all[key] = next;
        } else {
            delete all[key];
        }
        this.darakjianFacets = all;
    },

    darakjianIsFacetActive(attributeId, valueId) {
        return (this.darakjianFacets[String(attributeId)] || []).includes(valueId);
    },

    darakjianClearFacets() {
        this.darakjianFacets = {};
    },

    get darakjianActiveFacetCount() {
        return Object.values(this.darakjianFacets).reduce((n, arr) => n + arr.length, 0);
    },

    /** Does the product pass the active facet filter?
     *  AND across different attributes, OR across values of the same attribute. */
    darakjianProductMatches(product) {
        const keys = Object.keys(this.darakjianFacets);
        if (!keys.length) {
            return true;
        }
        const productValues = product.darakjian_facet_values || {};
        return keys.every((attrId) => {
            const wanted = this.darakjianFacets[attrId];
            const have = productValues[attrId] || [];
            return have.some((vid) => wanted.includes(vid));
        });
    },

    /** Index of every loaded quant by variant id, rebuilt only when the quant count
     *  changes (not on every call). The product grid calls darakjianQuantsForTemplate
     *  once per visible card on every render (needsCasePicker, the stock badge); doing
     *  a .filter() over every loaded quant each time is an O(cards x quants) scan that
     *  got noticeably slow once the badge made every card ask. This turns each card's
     *  lookup into O(its own variant count) instead. */
    get _darakjianQuantsByVariant() {
        const quantModel = this.models["stock.quant"];
        const all = quantModel ? quantModel.getAll() : [];
        if (this._darakjianQuantIndexLen !== all.length) {
            const rel = (v) => (v && v.id !== undefined ? v.id : v);
            const index = new Map();
            for (const q of all) {
                const vid = rel(q.product_id);
                if (!index.has(vid)) {
                    index.set(vid, []);
                }
                index.get(vid).push(q);
            }
            this._darakjianQuantIndexCache = index;
            this._darakjianQuantIndexLen = all.length;
        }
        return this._darakjianQuantIndexCache;
    },

    /** Quants of this product template's own variants - nothing else. Used both to
     *  decide whether the Case/Serial picker needs to open at all, and by the picker
     *  itself once it is open (DarakjianCaseSerialPicker.productQuants mirrors this). */
    darakjianQuantsForTemplate(productTmpl) {
        if (!productTmpl) {
            return [];
        }
        const rel = (v) => (v && v.id !== undefined ? v.id : v);
        const index = this._darakjianQuantsByVariant;
        const quants = [];
        for (const variant of productTmpl.product_variant_ids || []) {
            const vid = rel(variant);
            const vq = index.get(vid);
            if (vq) {
                quants.push(...vq);
            }
        }
        return quants;
    },

    /** Only for non-tracked products with more than one unit on hand. Serial (and lot)
     *  tracked products are deliberately excluded: native Odoo already asks for the
     *  lot/serial on its own and resolves the case from it (pack_lot_ids), so pre-
     *  picking a serial here only duplicated a prompt the cashier would see again
     *  right after - removed rather than kept as a redundant shortcut. */
    darakjianNeedsCasePicker(productTmpl) {
        if (!productTmpl || productTmpl.tracking !== "none") {
            return false;
        }
        return this.darakjianQuantsForTemplate(productTmpl).length > 1;
    },

    /** On-hand across every case, MINUS what is already in the current ticket, for the
     *  stock badge on the product card. Returns undefined for non-tracked products
     *  (services, combos) - they have no quants to count and the badge should not show
     *  a "0" that reads as "out of stock" for something that was never meant to carry
     *  inventory.
     *
     *  Odoo never re-fetches stock.quant from the server after a sale (by design - the
     *  POS has to keep working offline), so this can only ever reflect what the
     *  session loaded at open/last background refresh. Subtracting the current order's
     *  own lines is what keeps the number honest WITHIN one ticket: without it, adding
     *  the same product three times from three different cases still showed the
     *  original on-hand count on every click, with nothing warning the cashier they
     *  were past what was really left. */
    darakjianStockQty(productTmpl) {
        if (!productTmpl?.is_storable) {
            return undefined;
        }
        const onHand = this.darakjianQuantsForTemplate(productTmpl).reduce(
            (sum, q) => sum + q.quantity,
            0
        );
        const order = this.getOrder();
        const inTicket = order
            ? order
                  .getOrderlines()
                  .filter((line) => line.getProduct()?.product_tmpl_id?.id === productTmpl.id)
                  .reduce((sum, line) => sum + line.getQuantity(), 0)
            : 0;
        return onHand - inTicket;
    },

    // --- On-demand loading of non-priority products, category by category -----------
    // The catalog is NOT preloaded in the background: preloading the ~144 categories,
    // several of them holding thousands of products, saturated the POS sync queue and
    // jammed the session close. Instead each category is loaded ONLY when the cashier
    // selects it (see setSelectedCategory), bounded by DK_CATEG_LIMIT so that a huge
    // category (Watches, at 2.2k) cannot hang the UI.
    //
    // Built entirely on native Odoo 19 APIs: load_product_from_pos returns templates +
    // variants + taxes + attributes in the same shape as the initial payload (image_128
    // as a bool, so images come lazily by URL), and callRelated merges them through the
    // native connectNewData. No custom format and no custom merge, which is what makes it
    // survive upgrades.

    async darakjianLoadCateg(catId) {
        if (_dkLoadedCateg.has(catId) || _dkLoadingCateg.has(catId)) return;
        _dkLoadingCateg.add(catId);
        try {
            // Non-priority templates for the category; the priority ones already came
            // in with the initial load. Anything past the cap stays reachable through
            // the POS's native search.
            const domain = [
                ["pos_categ_ids", "=", catId],
                ["pos_load_priority", "=", false],
            ];
            await this.data.callRelated(
                "product.template",
                "load_product_from_pos",
                [this.config.id, domain, 0, DK_CATEG_LIMIT],
                // Flags this call (and only this one) for the server's stock gate -
                // native text search ("Search more") calls the same method without
                // this context key, and must still find zero-stock products on
                // purpose (e.g. to quote/follow up on something not on hand).
                { context: { darakjian_apply_stock_gate: true } },
                true,   // queue=true: sincroniza con el batch nativo evitando race conditions
                true,   // loadMissingRecords (trae relacionados faltantes)
            );
            _dkLoadedCateg.add(catId);
        } finally {
            _dkLoadingCateg.delete(catId);
        }
    },

    async darakjianEnsureCategLoaded(catId) {
        if (!catId || _dkLoadedCateg.has(catId)) return;
        // Deliberately not awaited: the load runs in the background and the UI updates
        // itself on merge, through connectNewData's reactivity. Navigation never blocks.
        this.darakjianLoadCateg(catId).catch((e) =>
            console.warn(`[Darakjian] loading category ${catId} failed:`, e)
        );
    },

    /** On picking a category, load its non-priority products right away if the
     *  background loop has not reached it yet - immediate beats eventual here. */
    setSelectedCategory(categoryId) {
        super.setSelectedCategory(categoryId);
        this.darakjianEnsureCategLoaded(categoryId);
    },

    /** Native hook, empty by default (point_of_sale/app/services/pos_store.js), called
     *  right after an order is confirmed server-side. The stock badge would otherwise
     *  keep showing the session's original on-hand count forever - Odoo never
     *  re-fetches stock after a sale, by design, so the POS can keep working offline -
     *  so this re-reads just the quant ROWS already known locally for whatever
     *  products were in the order that was just synced, instead of a full reload.
     *  New quants in a case never seen before are out of scope on purpose: a sale
     *  cannot create stock, only consume it, so there is never a new row to add here -
     *  only existing ones to correct or zero out. */
    async postSyncAllOrders(orders) {
        const result = await super.postSyncAllOrders(...arguments);
        try {
            await this.darakjianRefreshStockAfterSync(orders);
        } catch (e) {
            console.warn("[Darakjian] stock refresh after sale failed:", e);
        }
        return result;
    },

    async darakjianRefreshStockAfterSync(orders) {
        const quantModel = this.models["stock.quant"];
        if (!quantModel || !orders?.length) {
            return;
        }
        const rel = (v) => (v && v.id !== undefined ? v.id : v);
        const variantIds = new Set();
        for (const order of orders) {
            for (const line of order.lines || []) {
                const variant = line.product_id;
                if (variant) {
                    variantIds.add(rel(variant));
                }
            }
        }
        if (!variantIds.size) {
            return;
        }
        const localQuants = quantModel
            .getAll()
            .filter((q) => variantIds.has(rel(q.product_id)));
        if (!localQuants.length) {
            return;
        }
        const ids = localQuants.map((q) => q.id);
        const fresh = await this.data.orm.read("stock.quant", ids, ["quantity"]);
        const freshById = new Map(fresh.map((r) => [r.id, r.quantity]));
        for (const q of localQuants) {
            q.quantity = freshById.has(q.id) ? freshById.get(q.id) : 0;
        }
    },
});
